import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearFilmDetailsCache, filmDetails, tmdbFilm } from './film-details';

function jsonResponse(body: unknown, status = 200) {
	return new Response(JSON.stringify(body), { status });
}
const film = (overview: string) => ({ id: 1, overview, credits: { cast: [], crew: [] } });
const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.UTC(2030, 0, 1);

beforeEach(() => clearFilmDetailsCache());
afterEach(() => vi.useRealTimers());

describe('filmDetails', () => {
	it('asks in the viewer language', async () => {
		const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(film('Ein Gewürzkrieg.')));
		expect((await filmDetails(1, 'de', { apiKey: 'K', fetchImpl, now: NOW }))?.overview).toBe(
			'Ein Gewürzkrieg.'
		);
		expect(String(fetchImpl.mock.calls[0][0])).toContain('language=de-DE');
	});

	it('falls back to the English overview when the German one is empty', async () => {
		const fetchImpl = vi
			.fn()
			.mockResolvedValueOnce(jsonResponse(film('')))
			.mockResolvedValueOnce(jsonResponse(film('A spice war.')));
		expect((await filmDetails(1, 'de', { apiKey: 'K', fetchImpl, now: NOW }))?.overview).toBe(
			'A spice war.'
		);
		expect(String(fetchImpl.mock.calls[1][0])).toContain('language=en-US');
	});

	it('serves a second load within 24h from memory, and refetches after', async () => {
		const fetchImpl = vi.fn().mockImplementation(() => Promise.resolve(jsonResponse(film('x'))));
		await filmDetails(1, 'en', { apiKey: 'K', fetchImpl, now: NOW });
		await filmDetails(1, 'en', { apiKey: 'K', fetchImpl, now: NOW + DAY - 1 });
		expect(fetchImpl).toHaveBeenCalledTimes(1);
		await filmDetails(1, 'en', { apiKey: 'K', fetchImpl, now: NOW + DAY + 1 });
		expect(fetchImpl).toHaveBeenCalledTimes(2);
	});

	it('keeps languages apart in the cache', async () => {
		const fetchImpl = vi.fn().mockImplementation(() => Promise.resolve(jsonResponse(film('x'))));
		await filmDetails(1, 'en', { apiKey: 'K', fetchImpl, now: NOW });
		await filmDetails(1, 'de', { apiKey: 'K', fetchImpl, now: NOW });
		expect(fetchImpl).toHaveBeenCalledTimes(2);
	});

	it('keeps at most 500 films, dropping the oldest', async () => {
		const fetchImpl = vi.fn().mockImplementation(() => Promise.resolve(jsonResponse(film('x'))));
		for (let id = 1; id <= 501; id++) {
			await filmDetails(id, 'en', { apiKey: 'K', fetchImpl, now: NOW });
		}
		await filmDetails(501, 'en', { apiKey: 'K', fetchImpl, now: NOW });
		expect(fetchImpl).toHaveBeenCalledTimes(501);
		await filmDetails(1, 'en', { apiKey: 'K', fetchImpl, now: NOW });
		expect(fetchImpl).toHaveBeenCalledTimes(502);
	});

	it('does not cache a failure', async () => {
		const fetchImpl = vi
			.fn()
			.mockRejectedValueOnce(new Error('down'))
			.mockResolvedValueOnce(jsonResponse(film('back')));
		expect(await filmDetails(1, 'en', { apiKey: 'K', fetchImpl, now: NOW })).toBeNull();
		expect((await filmDetails(1, 'en', { apiKey: 'K', fetchImpl, now: NOW }))?.overview).toBe(
			'back'
		);
	});

	it('returns null without a key and makes no request', async () => {
		const fetchImpl = vi.fn();
		expect(await filmDetails(1, 'en', { apiKey: undefined, fetchImpl, now: NOW })).toBeNull();
		expect(fetchImpl).not.toHaveBeenCalled();
	});

	it('gives up after 5 seconds', async () => {
		vi.useFakeTimers();
		const fetchImpl = vi.fn(
			(_url: string | URL | Request, init?: RequestInit) =>
				new Promise<Response>((_, reject) =>
					init?.signal?.addEventListener('abort', () => reject(new Error('aborted')))
				)
		);
		const pending = filmDetails(1, 'en', { apiKey: 'K', fetchImpl, now: NOW });
		await vi.advanceTimersByTimeAsync(4999);
		let settled = false;
		void pending.then(() => (settled = true));
		await vi.advanceTimersByTimeAsync(0);
		expect(settled).toBe(false);
		await vi.advanceTimersByTimeAsync(1);
		expect(await pending).toBeNull();
	});
});

describe('tmdbFilm', () => {
	const movie = { id: 7, title: 'Fargo', release_date: '1996-03-08', poster_path: '/f.jpg' };

	it('asks TMDB once a day, and asks the limit only when it has to call', async () => {
		const fetchImpl = vi.fn(async () => jsonResponse(movie));
		const mayLookUp = vi.fn(() => true);
		const opts = { apiKey: 'k', fetchImpl, now: NOW, mayLookUp };
		expect((await tmdbFilm(7, opts))?.title).toBe('Fargo');
		expect((await tmdbFilm(7, opts))?.title).toBe('Fargo');
		expect(fetchImpl).toHaveBeenCalledTimes(1);
		expect(mayLookUp).toHaveBeenCalledTimes(1);
	});

	it('does not call TMDB over the limit, or without a key', async () => {
		const fetchImpl = vi.fn(async () => jsonResponse(movie));
		const over = { apiKey: 'k', fetchImpl, now: NOW, mayLookUp: () => false };
		expect(await tmdbFilm(7, over)).toBeNull();
		expect(await tmdbFilm(7, { apiKey: undefined, fetchImpl, now: NOW })).toBeNull();
		expect(fetchImpl).not.toHaveBeenCalled();
	});

	it('remembers that TMDB has no such film, but not that it failed', async () => {
		const missing = vi.fn(async () => jsonResponse({}, 404));
		const opts = { apiKey: 'k', fetchImpl: missing, now: NOW };
		await tmdbFilm(8, opts);
		await tmdbFilm(8, opts);
		expect(missing).toHaveBeenCalledTimes(1);
		const down = vi.fn(async () => jsonResponse({}, 500));
		await tmdbFilm(9, { apiKey: 'k', fetchImpl: down, now: NOW });
		await tmdbFilm(9, { apiKey: 'k', fetchImpl: down, now: NOW });
		expect(down).toHaveBeenCalledTimes(2);
	});
});
