import { eq } from 'drizzle-orm';
import type { DB } from './db/client';
import { movies } from './db/schema';

export type MovieInput = {
	tmdbId?: number | null;
	title: string;
	year?: number | null;
	posterUrl?: string | null;
	runtime?: number | null;
	genres?: string[] | null;
	tmdbRating?: number | null;
};

/**
 * The `movies` table is a cache, not a catalogue: metadata is fetched from TMDB
 * once and read from SQLite forever after, so a detail view works with no API
 * key and the instance does not phone out on every page load (PRD §5).
 *
 * One row per `tmdb_id`, shared across groups. A hand-entered film has no id,
 * so it gets its own row — two groups typing the same film by hand hold two
 * rows, which is correct: PRD §10 scopes the uniqueness rule to `tmdb_id`, and
 * per-group duplicate protection is the suggestion's `dedupe_key`, not this.
 */
export function findOrCreateMovie(db: DB, input: MovieInput): string {
	if (input.tmdbId != null) {
		const existing = db
			.select({ id: movies.id })
			.from(movies)
			.where(eq(movies.tmdbId, input.tmdbId))
			.get();
		if (existing) return existing.id;
	}
	const id = crypto.randomUUID();
	db.insert(movies)
		.values({
			id,
			tmdbId: input.tmdbId ?? null,
			title: input.title,
			year: input.year ?? null,
			posterUrl: input.posterUrl ?? null,
			runtime: input.runtime ?? null,
			genres: input.genres ?? null,
			tmdbRating: input.tmdbRating ?? null,
			cachedAt: new Date()
		})
		.run();
	return id;
}
