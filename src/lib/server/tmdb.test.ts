import { describe, expect, it, vi } from 'vitest';
import { fetchMovie, fetchMovieCredits, searchMovies } from './tmdb';

function jsonResponse(body: unknown, status = 200) {
	return new Response(JSON.stringify(body), { status });
}

const SEARCH_FIXTURE = {
	results: [
		{
			id: 438631,
			title: 'Dune',
			release_date: '2021-09-15',
			poster_path: '/d5NXSklXo0qyIYkgV94XAgMIckC.jpg',
			vote_average: 7.8
		},
		{ id: 841, title: 'Dune', release_date: '1984-12-14', poster_path: null, vote_average: 6.2 },
		{ id: 99, title: 'Unreleased', release_date: '', poster_path: null, vote_average: 0 }
	]
};

describe('searchMovies', () => {
	it('maps results to the shape the app stores', async () => {
		const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(SEARCH_FIXTURE));
		const results = await searchMovies('KEY', 'dune', fetchImpl);
		expect(results[0]).toEqual({
			tmdbId: 438631,
			title: 'Dune',
			year: 2021,
			posterUrl: 'https://image.tmdb.org/t/p/w342/d5NXSklXo0qyIYkgV94XAgMIckC.jpg',
			tmdbRating: 7.8
		});
	});

	it('turns a missing poster into null rather than a broken URL', async () => {
		const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(SEARCH_FIXTURE));
		expect((await searchMovies('KEY', 'dune', fetchImpl))[1].posterUrl).toBeNull();
	});

	it('turns an unparseable release date into a null year', async () => {
		const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(SEARCH_FIXTURE));
		expect((await searchMovies('KEY', 'dune', fetchImpl))[2].year).toBeNull();
	});

	it('sends the key and url-encodes the query', async () => {
		const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ results: [] }));
		await searchMovies('KEY', 'no way home', fetchImpl);
		const url = String(fetchImpl.mock.calls[0][0]);
		expect(url).toContain('api_key=KEY');
		expect(url).toContain('query=no%20way%20home');
		expect(url).toContain('include_adult=false');
	});

	it('returns an empty list when TMDB finds nothing', async () => {
		const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ results: [] }));
		expect(await searchMovies('KEY', 'zzzz', fetchImpl)).toEqual([]);
	});

	it('throws when TMDB refuses, so the route can offer manual entry instead', async () => {
		const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ status_message: 'nope' }, 401));
		await expect(searchMovies('BAD', 'dune', fetchImpl)).rejects.toThrow(/401/);
	});

	it('does not put the key in the thrown message', async () => {
		const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({}, 500));
		await expect(searchMovies('SECRET-KEY', 'dune', fetchImpl)).rejects.not.toThrow(/SECRET-KEY/);
	});

	it('does not leak the key when the transport itself fails', async () => {
		// Simulates a fetch implementation that puts the request URL — which
		// contains the key — into its own error message.
		const fetchImpl = vi
			.fn()
			.mockRejectedValue(new Error('connect ECONNREFUSED .../search/movie?api_key=SECRET-KEY'));
		let message = '';
		try {
			await searchMovies('SECRET-KEY', 'dune', fetchImpl);
		} catch (error) {
			message = String(error);
		}
		expect(message).not.toBe('');
		expect(message).not.toContain('SECRET-KEY');
	});

	it('wraps an unparseable body in a stable error instead of a raw parser message', async () => {
		const fetchImpl = vi.fn().mockResolvedValue(new Response('not json', { status: 200 }));
		let message = '';
		try {
			await searchMovies('KEY', 'dune', fetchImpl);
		} catch (error) {
			message = String(error);
		}
		// Discriminating: without the parse wrapper this is a raw SyntaxError
		// about the body's contents, which does not match.
		expect(message).toContain('could not be parsed');
	});

	it('treats a results field that is not an array as no results', async () => {
		const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ results: 'oops' }));
		expect(await searchMovies('KEY', 'dune', fetchImpl)).toEqual([]);
	});

	it('treats a missing results field as no results', async () => {
		const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({}));
		expect(await searchMovies('KEY', 'dune', fetchImpl)).toEqual([]);
	});

	it('drops a result whose id is unusable rather than keying it as NaN', async () => {
		const fetchImpl = vi
			.fn()
			.mockResolvedValue(
				jsonResponse({ results: [{ title: 'No Id', release_date: '2020-01-01' }] })
			);
		expect(await searchMovies('KEY', 'dune', fetchImpl)).toEqual([]);
	});

	it('treats an unvoted film as having no rating rather than a rating of zero', async () => {
		const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(SEARCH_FIXTURE));
		expect((await searchMovies('KEY', 'dune', fetchImpl))[2].tmdbRating).toBeNull();
	});
});

describe('fetchMovie', () => {
	it('returns the details the movies table caches', async () => {
		const fetchImpl = vi.fn().mockResolvedValue(
			jsonResponse({
				id: 438631,
				title: 'Dune',
				release_date: '2021-09-15',
				poster_path: '/p.jpg',
				vote_average: 7.8,
				runtime: 155,
				genres: [
					{ id: 878, name: 'Science Fiction' },
					{ id: 12, name: 'Adventure' }
				]
			})
		);
		expect(await fetchMovie('KEY', 438631, fetchImpl)).toEqual({
			tmdbId: 438631,
			title: 'Dune',
			year: 2021,
			posterUrl: 'https://image.tmdb.org/t/p/w342/p.jpg',
			tmdbRating: 7.8,
			runtime: 155,
			genres: ['Science Fiction', 'Adventure']
		});
	});

	it('returns null for a film TMDB does not have', async () => {
		const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({}, 404));
		expect(await fetchMovie('KEY', 1, fetchImpl)).toBeNull();
	});
});

describe('fetchMovieCredits', () => {
	const cast = Array.from({ length: 8 }, (_, i) => ({
		name: `Actor ${7 - i}`,
		character: `Role ${7 - i}`,
		order: 7 - i
	}));
	const FIXTURE = {
		id: 438631,
		overview: 'A spice war.',
		credits: {
			cast,
			crew: [
				{ job: 'Director', name: 'Denis Villeneuve' },
				{ job: 'Writer', name: 'Jon Spaihts' }
			]
		}
	};

	it('maps the overview, the directors and the first 6 cast in order', async () => {
		const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(FIXTURE));
		expect(await fetchMovieCredits('KEY', 438631, 'de-DE', fetchImpl)).toEqual({
			overview: 'A spice war.',
			directors: ['Denis Villeneuve'],
			cast: [0, 1, 2, 3, 4, 5].map((n) => ({ name: `Actor ${n}`, character: `Role ${n}` }))
		});
		const url = String(fetchImpl.mock.calls[0][0]);
		expect(url).toContain('/movie/438631?');
		expect(url).toContain('append_to_response=credits');
		expect(url).toContain('language=de-DE');
	});

	it('treats missing or malformed credits as empty and an empty overview as null', async () => {
		const fetchImpl = vi
			.fn()
			.mockResolvedValue(jsonResponse({ id: 1, overview: '', credits: { cast: 'nope' } }));
		expect(await fetchMovieCredits('KEY', 1, 'en-US', fetchImpl)).toEqual({
			overview: null,
			directors: [],
			cast: []
		});
	});

	it('keeps a cast member without a character, with character null', async () => {
		const fetchImpl = vi
			.fn()
			.mockResolvedValue(
				jsonResponse({ id: 1, overview: 'x', credits: { cast: [{ name: 'Solo', order: 0 }] } })
			);
		expect((await fetchMovieCredits('KEY', 1, 'en-US', fetchImpl))?.cast).toEqual([
			{ name: 'Solo', character: null }
		]);
	});

	it('returns null for an unknown film', async () => {
		const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({}, 404));
		expect(await fetchMovieCredits('KEY', 1, 'en-US', fetchImpl)).toBeNull();
	});

	it('never puts the key into the error', async () => {
		const fetchImpl = vi.fn().mockRejectedValue(new Error('GET https://x?api_key=SECRETKEY'));
		await expect(fetchMovieCredits('SECRETKEY', 1, 'en-US', fetchImpl)).rejects.toThrow(
			/could not be reached/
		);
		const refused = vi.fn().mockResolvedValue(jsonResponse({}, 500));
		await expect(fetchMovieCredits('SECRETKEY', 1, 'en-US', refused)).rejects.not.toThrow(
			/SECRETKEY/
		);
	});
});
