import { and, eq } from 'drizzle-orm';
import type { DB } from './db/client';
import { groups, movies, suggestions } from './db/schema';
import { groupSettings } from './group-settings';
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

/**
 * All that a signed-out visitor's link preview gets: the film's title and poster,
 * by the same rule as its page, so it can't give away a surprise either. Nothing
 * about the group, its members or how they voted.
 */
export function filmPreview(db: DB, groupId: string, suggestionId: string) {
	const group = db
		.select({ settings: groups.settings })
		.from(groups)
		.where(eq(groups.id, groupId))
		.get();
	if (!group) return null;
	const film = pooledFilm(
		db,
		groupId,
		'',
		suggestionId,
		groupSettings(group.settings).resultVisible
	);
	return film && previewOf(film);
}

/** Exactly what a link preview may show of a film. */
export function previewOf(film: { title: string; year: number | null; posterUrl: string | null }) {
	return {
		title: film.year ? `${film.title} (${film.year})` : film.title,
		image: film.posterUrl
	};
}
