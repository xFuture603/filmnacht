import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { liveSearch } from './live-search';

type Hit = { title: string };

/** A fetch whose responses the test releases one by one. */
function controllableFetch() {
	const calls: {
		url: string;
		signal: AbortSignal;
		resolve: (body: unknown, ok?: boolean) => void;
	}[] = [];
	const fetchImpl = vi.fn((url: string, init: RequestInit) => {
		return new Promise<Response>((resolve, reject) => {
			const signal = init.signal!;
			signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
			calls.push({
				url,
				signal,
				resolve: (body, ok = true) =>
					resolve(new Response(JSON.stringify(body), { status: ok ? 200 : 502 }))
			});
		});
	});
	return { fetchImpl: fetchImpl as unknown as typeof fetch, calls };
}

function setup() {
	const { fetchImpl, calls } = controllableFetch();
	const results: (Hit[] | null)[] = [];
	const onError = vi.fn();
	const busy: boolean[] = [];
	const search = liveSearch<Hit>({
		onBusy: (b) => busy.push(b),
		url: (q) => `/search?q=${q}`,
		onResults: (r) => results.push(r),
		onError,
		fetchImpl
	});
	return { search, calls, results, onError, busy };
}

const settle = () => vi.advanceTimersByTimeAsync(0);

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('live search', () => {
	it('searches once, for the final text, 300ms after typing stops', async () => {
		const { search, calls } = setup();
		search.type('du');
		await vi.advanceTimersByTimeAsync(200);
		search.type('dun');
		await vi.advanceTimersByTimeAsync(200);
		search.type('dune');
		await vi.advanceTimersByTimeAsync(299);
		expect(calls).toHaveLength(0);
		await vi.advanceTimersByTimeAsync(1);
		expect(calls.map((c) => c.url)).toEqual(['/search?q=dune']);
	});

	it('delivers the results it gets back', async () => {
		const { search, calls, results } = setup();
		search.type('dune');
		await vi.advanceTimersByTimeAsync(300);
		calls[0].resolve({ results: [{ title: 'Dune' }] });
		await settle();
		expect(results).toEqual([[{ title: 'Dune' }]]);
	});

	it('clears the results for text under two characters, without asking', async () => {
		const { search, calls, results } = setup();
		search.type(' d ');
		await vi.advanceTimersByTimeAsync(1000);
		expect(calls).toHaveLength(0);
		expect(results).toEqual([null]);
	});

	// Typing on while a search is out must not let the older, slower answer
	// overwrite the newer one.
	it('cancels the search in flight when a newer one starts, and drops its answer', async () => {
		const { search, calls, results } = setup();
		search.type('dune');
		await vi.advanceTimersByTimeAsync(300);
		search.type('dune part');
		await vi.advanceTimersByTimeAsync(300);
		expect(calls[0].signal.aborted).toBe(true);
		calls[1].resolve({ results: [{ title: 'Dune: Part Two' }] });
		await settle();
		expect(results).toEqual([[{ title: 'Dune: Part Two' }]]);
	});

	it('cancels the search in flight when the text gets too short', async () => {
		const { search, calls, results } = setup();
		search.type('dune');
		await vi.advanceTimersByTimeAsync(300);
		search.type('d');
		expect(calls[0].signal.aborted).toBe(true);
		await settle();
		expect(results).toEqual([null]);
	});

	it('reports a failed search', async () => {
		const { search, calls, onError, results } = setup();
		search.type('dune');
		await vi.advanceTimersByTimeAsync(300);
		calls[0].resolve({}, false);
		await settle();
		expect(onError).toHaveBeenCalledOnce();
		expect(results).toEqual([]);
	});

	it('searches at once when asked to, without waiting', async () => {
		const { search, calls } = setup();
		search.now('dune');
		await settle();
		expect(calls.map((c) => c.url)).toEqual(['/search?q=dune']);
	});

	// Typing must show at once that a search is coming, not only once the
	// request goes out after the pause.
	it('is busy from the first keystroke until the results arrive', async () => {
		const { search, calls, busy } = setup();
		search.type('dune');
		expect(busy.at(-1)).toBe(true);
		await vi.advanceTimersByTimeAsync(300);
		expect(busy.at(-1)).toBe(true);
		calls[0].resolve({ results: [] });
		await settle();
		expect(busy.at(-1)).toBe(false);
	});

	it('stays busy while a newer search replaces one in flight', async () => {
		const { search, calls, busy } = setup();
		search.type('dune');
		await vi.advanceTimersByTimeAsync(300);
		search.type('dune part');
		await settle();
		expect(busy.at(-1)).toBe(true);
		await vi.advanceTimersByTimeAsync(300);
		calls[1].resolve({ results: [] });
		await settle();
		expect(busy.at(-1)).toBe(false);
	});

	it('is no longer busy when the search fails or the text gets too short', async () => {
		const { search, calls, busy } = setup();
		search.type('dune');
		await vi.advanceTimersByTimeAsync(300);
		calls[0].resolve({}, false);
		await settle();
		expect(busy.at(-1)).toBe(false);
		search.type('dune');
		search.type('d');
		await settle();
		expect(busy.at(-1)).toBe(false);
	});
});
