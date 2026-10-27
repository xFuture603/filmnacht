const API = 'https://api.themoviedb.org/3';
const POSTER = 'https://image.tmdb.org/t/p/w342';

export type TmdbSearchResult = {
	tmdbId: number;
	title: string;
	year: number | null;
	posterUrl: string | null;
	tmdbRating: number | null;
};

export type TmdbMovieDetail = TmdbSearchResult & {
	runtime: number | null;
	genres: string[];
};

function yearOf(releaseDate: unknown): number | null {
	const year = Number(String(releaseDate ?? '').slice(0, 4));
	return Number.isInteger(year) && year > 1800 ? year : null;
}

function posterFrom(path: unknown): string | null {
	return typeof path === 'string' && path ? `${POSTER}${path}` : null;
}

function ratingFrom(value: unknown): number | null {
	return typeof value === 'number' && value > 0 ? value : null;
}

/** Never interpolate the key into anything that could be logged or rendered. */
function refuse(what: string, status: number): never {
	throw new Error(`TMDB ${what} failed with status ${status}`);
}

/**
 * The request URL carries the API key, and some fetch implementations put the
 * URL into their own error message — so nothing from the transport layer is
 * allowed to propagate unmodified.
 */
async function request(
	url: string,
	what: string,
	fetchImpl: typeof fetch,
	signal?: AbortSignal
): Promise<Response> {
	try {
		return await fetchImpl(url, signal ? { signal } : undefined);
	} catch {
		throw new Error(`TMDB ${what} failed: the service could not be reached`);
	}
}

/** Keeps raw parser internals out of callers; every failure leaves this module in one shape. */
async function parse(response: Response, what: string): Promise<Record<string, unknown>> {
	try {
		return (await response.json()) as Record<string, unknown>;
	} catch {
		throw new Error(`TMDB ${what} returned a response that could not be parsed`);
	}
}

export async function searchMovies(
	apiKey: string,
	query: string,
	fetchImpl: typeof fetch = fetch
): Promise<TmdbSearchResult[]> {
	const url = `${API}/search/movie?api_key=${encodeURIComponent(apiKey)}&include_adult=false&query=${encodeURIComponent(query)}`;
	const response = await request(url, 'search', fetchImpl);
	if (!response.ok) refuse('search', response.status);
	const body = await parse(response, 'search');
	const results = Array.isArray(body.results) ? body.results : [];
	return results
		.map((raw) => {
			const item = raw as Record<string, unknown>;
			return {
				tmdbId: Number(item.id),
				title: String(item.title ?? ''),
				year: yearOf(item.release_date),
				posterUrl: posterFrom(item.poster_path),
				tmdbRating: ratingFrom(item.vote_average)
			};
		})
		.filter((result) => Number.isInteger(result.tmdbId));
}

export async function fetchMovie(
	apiKey: string,
	tmdbId: number,
	fetchImpl: typeof fetch = fetch
): Promise<TmdbMovieDetail | null> {
	const url = `${API}/movie/${tmdbId}?api_key=${encodeURIComponent(apiKey)}`;
	const response = await request(url, 'detail lookup', fetchImpl);
	if (response.status === 404) return null;
	if (!response.ok) refuse('detail lookup', response.status);
	const item = await parse(response, 'detail lookup');
	// A malformed body must not produce `tmdbId: NaN` — that value still passes
	// the `!= null` check in findOrCreateMovie and collides every malformed film
	// in a group onto the single dedupe key `tmdb:NaN`.
	if (!Number.isInteger(Number(item.id)) || Number(item.id) <= 0) return null;
	const genres = Array.isArray(item.genres)
		? (item.genres as { name?: unknown }[]).map((g) => String(g.name ?? '')).filter(Boolean)
		: [];
	return {
		tmdbId: Number(item.id),
		title: String(item.title ?? ''),
		year: yearOf(item.release_date),
		posterUrl: posterFrom(item.poster_path),
		tmdbRating: ratingFrom(item.vote_average),
		runtime: typeof item.runtime === 'number' && item.runtime > 0 ? item.runtime : null,
		genres
	};
}

export type TmdbCredits = {
	overview: string | null;
	directors: string[];
	cast: { name: string; character: string | null }[];
};

const CAST_SHOWN = 6;

function listOf(value: unknown): Record<string, unknown>[] {
	return Array.isArray(value) ? (value as Record<string, unknown>[]) : [];
}

/** Summary, directors and top-billed cast for the film page, in one request. */
export async function fetchMovieCredits(
	apiKey: string,
	tmdbId: number,
	language: 'de-DE' | 'en-US',
	fetchImpl: typeof fetch = fetch,
	signal?: AbortSignal
): Promise<TmdbCredits | null> {
	const url = `${API}/movie/${tmdbId}?api_key=${encodeURIComponent(apiKey)}&append_to_response=credits&language=${language}`;
	const response = await request(url, 'credits lookup', fetchImpl, signal);
	if (response.status === 404) return null;
	if (!response.ok) refuse('credits lookup', response.status);
	const item = await parse(response, 'credits lookup');
	const credits = (item.credits ?? {}) as Record<string, unknown>;
	const overview = typeof item.overview === 'string' && item.overview.trim() ? item.overview : null;
	return {
		overview,
		directors: listOf(credits.crew)
			.filter((c) => c.job === 'Director' && typeof c.name === 'string')
			.map((c) => String(c.name)),
		cast: listOf(credits.cast)
			.filter((c) => typeof c.name === 'string')
			.sort((a, b) => Number(a.order ?? 0) - Number(b.order ?? 0))
			.slice(0, CAST_SHOWN)
			.map((c) => ({
				name: String(c.name),
				character: typeof c.character === 'string' && c.character ? c.character : null
			}))
	};
}
