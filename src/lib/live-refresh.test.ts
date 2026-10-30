import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { startLiveRefresh, whenReachable } from './live-refresh';

class FakeDocument extends EventTarget {
	visibilityState: DocumentVisibilityState = 'visible';
	become(state: DocumentVisibilityState) {
		this.visibilityState = state;
		this.dispatchEvent(new Event('visibilitychange'));
	}
}

let doc: FakeDocument;
let win: EventTarget;
let refresh: Mock<() => void>;

beforeEach(() => {
	vi.useFakeTimers();
	doc = new FakeDocument();
	win = new EventTarget();
	refresh = vi.fn();
});

afterEach(() => {
	vi.useRealTimers();
});

describe('startLiveRefresh', () => {
	it('refreshes on the interval while the page is visible', () => {
		startLiveRefresh(refresh, { intervalMs: 1000, doc, win });
		vi.advanceTimersByTime(3000);
		expect(refresh).toHaveBeenCalledTimes(3);
	});

	it('does not refresh while the page is hidden', () => {
		startLiveRefresh(refresh, { intervalMs: 1000, doc, win });
		doc.become('hidden');
		vi.advanceTimersByTime(5000);
		expect(refresh).not.toHaveBeenCalled();
	});

	it('refreshes at once when the page becomes visible again, then on the interval', () => {
		startLiveRefresh(refresh, { intervalMs: 1000, doc, win });
		doc.become('hidden');
		vi.advanceTimersByTime(5000);
		doc.become('visible');
		expect(refresh).toHaveBeenCalledTimes(1);
		vi.advanceTimersByTime(1000);
		expect(refresh).toHaveBeenCalledTimes(2);
	});

	it('refreshes at once when its window gets focus back from another window', () => {
		// Two windows side by side: switching between them changes focus, not visibility.
		startLiveRefresh(refresh, { intervalMs: 1000, doc, win });
		win.dispatchEvent(new Event('focus'));
		expect(refresh).toHaveBeenCalledTimes(1);
	});

	it('does nothing after it is stopped', () => {
		const stop = startLiveRefresh(refresh, { intervalMs: 1000, doc, win });
		stop();
		vi.advanceTimersByTime(5000);
		doc.become('hidden');
		doc.become('visible');
		win.dispatchEvent(new Event('focus'));
		expect(refresh).not.toHaveBeenCalled();
	});
});

// A refresh that fails on the way (a laptop waking before its Wi-Fi, a proxy
// or server restarting) makes SvelteKit swap the whole page for a 500. A
// background refresh must skip that round instead and try again next time.
describe('whenReachable', () => {
	const fetchThat = (respond: () => Promise<Response>) => vi.fn(respond) as unknown as typeof fetch;

	it('refreshes when the server answers', async () => {
		const go = vi.fn();
		await whenReachable(
			go,
			fetchThat(async () => new Response('ok'))
		)();
		expect(go).toHaveBeenCalledOnce();
	});

	it('skips the refresh when the network is down', async () => {
		const go = vi.fn();
		await whenReachable(
			go,
			fetchThat(() => Promise.reject(new TypeError('Failed to fetch')))
		)();
		expect(go).not.toHaveBeenCalled();
	});

	it('skips the refresh when a proxy answers with an error', async () => {
		const go = vi.fn();
		await whenReachable(
			go,
			fetchThat(async () => new Response('Bad Gateway', { status: 502 }))
		)();
		expect(go).not.toHaveBeenCalled();
	});
});

describe('pages that refresh themselves', () => {
	const pages = import.meta.glob('/src/routes/**/*.svelte', {
		query: '?raw',
		import: 'default',
		eager: true
	}) as Record<string, string>;
	const refreshing = Object.entries(pages).filter(([, source]) =>
		source.includes('startLiveRefresh(')
	);

	it('all check that the server is reachable first', () => {
		expect(refreshing.length).toBeGreaterThan(0);
		for (const [path, source] of refreshing) {
			expect(source, path).not.toMatch(/startLiveRefresh\((?!whenReachable\()/);
		}
	});
});
