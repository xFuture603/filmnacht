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

export async function searchMovies(
	apiKey: string,
	query: string,
	fetchImpl: typeof fetch = fetch
): Promise<TmdbSearchResult[]> {
	const url = `${API}/search/movie?api_key=${encodeURIComponent(apiKey)}&include_adult=false&query=${encodeURIComponent(query)}`;
	const response = await fetchImpl(url);
	if (!response.ok) refuse('search', response.status);
	const body = (await response.json()) as { results?: unknown[] };
	return (body.results ?? []).map((raw) => {
		const item = raw as Record<string, unknown>;
		return {
			tmdbId: Number(item.id),
			title: String(item.title ?? ''),
			year: yearOf(item.release_date),
			posterUrl: posterFrom(item.poster_path),
			tmdbRating: ratingFrom(item.vote_average)
		};
	});
}

export async function fetchMovie(
	apiKey: string,
	tmdbId: number,
	fetchImpl: typeof fetch = fetch
): Promise<TmdbMovieDetail | null> {
	const url = `${API}/movie/${tmdbId}?api_key=${encodeURIComponent(apiKey)}`;
	const response = await fetchImpl(url);
	if (response.status === 404) return null;
	if (!response.ok) refuse('detail lookup', response.status);
	const item = (await response.json()) as Record<string, unknown>;
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
