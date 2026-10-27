import { and, eq } from 'drizzle-orm';
import type { DB } from './db/client';
import { movies, suggestions } from './db/schema';
import { unrevealedDrawnIds } from './nights';
import { listPool } from './suggestions';

type ResultVisible = 'immediately' | 'on_night';

/**
 * With `resultVisible: 'on_night'` the film drawn for a night still to come is
 * a surprise, and a pool entry badged "drawn" would give it away. It is left
 * out of the pool until the night starts, not merely unbadged: withdrawing it
 * would answer "already drawn" and say the same thing.
 */
export function visiblePool(
	db: DB,
	groupId: string,
	viewerId: string,
	resultVisible: ResultVisible,
	now = new Date()
) {
	const pool = listPool(db, groupId, viewerId);
	if (resultVisible === 'immediately') return pool;
	const hidden = unrevealedDrawnIds(db, groupId, now);
	return pool.filter((entry) => !hidden.has(entry.suggestionId));
}

/**
 * A film's page exists exactly while the pool lists it: the same rule, so the
 * page can never show a surprise the pool is keeping.
 */
export function pooledFilm(
	db: DB,
	groupId: string,
	viewerId: string,
	suggestionId: string,
	resultVisible: ResultVisible,
	now = new Date()
) {
	const listed = visiblePool(db, groupId, viewerId, resultVisible, now).some(
		(entry) => entry.suggestionId === suggestionId
	);
	if (!listed) return null;
	const row = db
		.select({
			tmdbId: movies.tmdbId,
			title: movies.title,
			year: movies.year,
			posterUrl: movies.posterUrl,
			runtime: movies.runtime,
			genres: movies.genres,
			tmdbRating: movies.tmdbRating
		})
		.from(suggestions)
		.innerJoin(movies, eq(movies.id, suggestions.movieId))
		.where(and(eq(suggestions.id, suggestionId), eq(suggestions.groupId, groupId)))
		.get();
	return row ? { ...row, genres: row.genres ?? [] } : null;
}
