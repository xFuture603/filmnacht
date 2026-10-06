import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { startLiveRefresh } from './live-refresh';

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
