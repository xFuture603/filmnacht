import { env } from '$env/dynamic/private';
import type { Locale } from '$lib/i18n';
import { fetchMovie, fetchMovieCredits, type TmdbCredits, type TmdbMovieDetail } from './tmdb';

/**
 * The film page's summary and cast, fetched when someone opens it and kept in
 * memory for a day: nothing is stored, and a restart just empties the cache.
 * Any failure is null, so the page falls back to what the pool already knows.
 */

const DAY = 24 * 60 * 60 * 1000;
const TIMEOUT = 5000;
const MAX_ENTRIES = 500;

const cache = new Map<string, { value: unknown; at: number }>();

export function clearFilmDetailsCache(): void {
	cache.clear();
}

async function load(
	apiKey: string,
	tmdbId: number,
	locale: Locale,
	fetchImpl: typeof fetch,
	signal: AbortSignal
): Promise<TmdbCredits | null> {
	const details = await fetchMovieCredits(
		apiKey,
		tmdbId,
		locale === 'de' ? 'de-DE' : 'en-US',
		fetchImpl,
		signal
	);
	if (!details || details.overview || locale === 'en') return details;
	// TMDB often has no German summary: the English one beats none.
	const english = await fetchMovieCredits(apiKey, tmdbId, 'en-US', fetchImpl, signal);
	return { ...details, overview: english?.overview ?? null };
}

/** One cached lookup: at most one TMDB call a day per key, unless it failed. */
async function cached<T>(
	key: string,
	now: number,
	lookup: (signal: AbortSignal) => Promise<T | null>,
	mayLookUp: () => boolean = () => true
): Promise<T | null> {
	const hit = cache.get(key);
	if (hit && now - hit.at < DAY) return hit.value as T | null;
	if (!mayLookUp()) return null;

	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), TIMEOUT);
	try {
		const value = await lookup(controller.signal);
		cache.delete(key);
		cache.set(key, { value, at: now });
		// Insertion order is age: the first key is the oldest.
		if (cache.size > MAX_ENTRIES) cache.delete(cache.keys().next().value!);
		return value;
	} catch {
		return null;
	} finally {
		clearTimeout(timer);
	}
}

export async function filmDetails(
	tmdbId: number,
	locale: Locale,
	opts: { apiKey?: string | undefined; fetchImpl?: typeof fetch; now?: number } = {}
): Promise<TmdbCredits | null> {
	const { fetchImpl = fetch, now = Date.now() } = opts;
	const apiKey = 'apiKey' in opts ? opts.apiKey : env.TMDB_API_KEY;
	if (!apiKey) return null;
	return cached(`${tmdbId}:${locale}`, now, (signal) =>
		load(apiKey, tmdbId, locale, fetchImpl, signal)
	);
}

/**
 * A film that isn't in any pool yet, by its TMDB id. `mayLookUp` is asked only
 * when TMDB would have to be called, so a limit never gets in the way of an answer
 * that is already known.
 */
export async function tmdbFilm(
	tmdbId: number,
	opts: {
		apiKey?: string | undefined;
		fetchImpl?: typeof fetch;
		now?: number;
		mayLookUp?: () => boolean;
	} = {}
): Promise<TmdbMovieDetail | null> {
	const { fetchImpl = fetch, now = Date.now(), mayLookUp } = opts;
	const apiKey = 'apiKey' in opts ? opts.apiKey : env.TMDB_API_KEY;
	if (!apiKey) return null;
	return cached(
		`movie:${tmdbId}`,
		now,
		(signal) => fetchMovie(apiKey, tmdbId, fetchImpl, signal),
		mayLookUp
	);
}
