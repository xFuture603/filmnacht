import { and, eq, inArray, or } from 'drizzle-orm';
import type { DB } from './db/client';
import { movieNights, movies, suggestions, type GroupSettings } from './db/schema';
import { dedupeKey } from './dedupe';
import { findOrCreateMovie, type MovieInput } from './movies';

export const NOTE_MAX = 200;
export const TITLE_MAX = 200;

export type AddResult =
	| { ok: true; suggestionId: string }
	| { ok: false; reason: 'duplicate' | 'cap_reached' | 'bad_title' };

/**
 * What a member may see about a film before the draw. There is deliberately no
 * author field: `mine` is the only thing said about ownership, so no route or
 * component can leak who suggested what. PRD §5 reveals that with the draw.
 */
export type PoolEntry = {
	suggestionId: string;
	title: string;
	year: number | null;
	posterUrl: string | null;
	runtime: number | null;
	mine: boolean;
	status: 'open' | 'drawn';
	/** The night a drawn film was drawn for. "Drawn" is not "watched" until that night is. */
	night: { scheduledAt: Date; watched: boolean } | null;
};

export function countOpenSuggestions(db: DB, groupId: string, userId: string): number {
	return db
		.select({ id: suggestions.id })
		.from(suggestions)
		.where(
			and(
				eq(suggestions.groupId, groupId),
				eq(suggestions.suggestedBy, userId),
				eq(suggestions.status, 'open')
			)
		)
		.all().length;
}

export function addSuggestion(
	db: DB,
	input: {
		groupId: string;
		userId: string;
		movie: MovieInput;
		note?: string | null;
		settings: GroupSettings;
	}
): AddResult {
	const title = input.movie.title.trim();
	if (!title || title.length > TITLE_MAX) return { ok: false, reason: 'bad_title' };

	const key = dedupeKey({ ...input.movie, title });
	// An over-long note is trimmed rather than rejected: losing the film because
	// someone was chatty is a worse outcome than a clipped sentence.
	const note = input.note?.trim().slice(0, NOTE_MAX) || null;

	// The cap check and the insert must be one step. Checking before an `await`
	// in a route would let two tabs both pass a cap of 3 at 3 suggestions.
	return db.transaction(() => {
		if (
			countOpenSuggestions(db, input.groupId, input.userId) >= input.settings.maxOpenSuggestions
		) {
			return { ok: false, reason: 'cap_reached' } as const;
		}
		const clash = db
			.select({ id: suggestions.id, status: suggestions.status })
			.from(suggestions)
			.where(and(eq(suggestions.groupId, input.groupId), eq(suggestions.dedupeKey, key)))
			.get();
		// Deliberately does not say who: PRD §5 rejects duplicates without
		// revealing who added the film first.
		if (clash && clash.status !== 'withdrawn') return { ok: false, reason: 'duplicate' } as const;

		if (clash) {
			const used = db
				.select({ id: movieNights.id })
				.from(movieNights)
				.where(eq(movieNights.suggestionId, clash.id))
				.get();
			// A night already points at this suggestion, so its suggester is part of
			// the group's history — reviving would retroactively re-credit a film
			// someone else had drawn or watched.
			if (used) return { ok: false, reason: 'duplicate' } as const;

			// Revive rather than insert: the unique (group_id, dedupe_key) constraint
			// still holds the withdrawn row's slot, so an insert would collide.
			// Reattributed to whoever is adding it now — cap accounting keys off
			// suggestedBy, so leaving the old attribution would charge the film to
			// the original suggester and show as not-yours to the person who just
			// added it. The old note is dropped rather than carried: it was written
			// to be revealed alongside that person's suggestion, and moving it to a
			// different member's row is an indirect leak of exactly the kind §5 exists
			// to prevent. `movieId` is deliberately left untouched: the dedupe key
			// match guarantees this is the same film, so the revived row keeps
			// pointing at its existing `movies` row. Calling `findOrCreateMovie` here
			// would, for a hand-typed film with no `tmdb_id`, insert a brand new
			// `movies` row that nothing then references — exactly the leak this
			// branch exists to avoid. `createdAt` is reset because the row now
			// represents a different member's suggestion, in every other field.
			db.update(suggestions)
				.set({ status: 'open', suggestedBy: input.userId, note, createdAt: new Date() })
				.where(eq(suggestions.id, clash.id))
				.run();
			return { ok: true, suggestionId: clash.id } as const;
		}

		const movieId = findOrCreateMovie(db, { ...input.movie, title });
		const suggestionId = crypto.randomUUID();
		db.insert(suggestions)
			.values({
				id: suggestionId,
				groupId: input.groupId,
				movieId,
				suggestedBy: input.userId,
				dedupeKey: key,
				note
			})
			.run();
		return { ok: true, suggestionId } as const;
	});
}

export function withdrawSuggestion(
	db: DB,
	userId: string,
	suggestionId: string
): 'ok' | 'not_found' | 'already_drawn' {
	return db.transaction(() => {
		const row = db
			.select({ status: suggestions.status, suggestedBy: suggestions.suggestedBy })
			.from(suggestions)
			.where(eq(suggestions.id, suggestionId))
			.get();
		// Someone else's suggestion is "not found", not "forbidden" — the pool is
		// anonymous, so confirming it exists would say more than it should.
		if (!row || row.suggestedBy !== userId) return 'not_found' as const;
		if (row.status !== 'open') return 'already_drawn' as const;
		db.update(suggestions)
			.set({ status: 'withdrawn' })
			.where(eq(suggestions.id, suggestionId))
			.run();
		return 'ok' as const;
	});
}

export function listPool(db: DB, groupId: string, viewerId: string): PoolEntry[] {
	// Drawn films stay on show as the group's history and are never drawn again.
	// There was a `repeatDrawnFilms` setting here that only ever controlled this
	// visibility and never made a watched film drawable, so a group with it on saw
	// entries labelled "already watched" that could not be picked. It appeared
	// nowhere in the PRD; dropped rather than given a second meaning.
	// `withdrawn` is still excluded — that is a member retracting a suggestion,
	// not something the group watched.
	const visible = or(eq(suggestions.status, 'open'), eq(suggestions.status, 'drawn'));

	return (
		db
			.select({
				suggestionId: suggestions.id,
				suggestedBy: suggestions.suggestedBy,
				status: suggestions.status,
				title: movies.title,
				year: movies.year,
				posterUrl: movies.posterUrl,
				runtime: movies.runtime,
				nightAt: movieNights.scheduledAt,
				nightStatus: movieNights.status
			})
			.from(suggestions)
			.innerJoin(movies, eq(movies.id, suggestions.movieId))
			// A cancelled night released its film back to the pool, so only a live
			// draw counts — and a film is drawn for at most one of those.
			.leftJoin(
				movieNights,
				and(
					eq(movieNights.suggestionId, suggestions.id),
					inArray(movieNights.status, ['drawn', 'watched'])
				)
			)
			.where(and(eq(suggestions.groupId, groupId), visible))
			.orderBy(movies.title)
			.all()
			.map((row) => ({
				suggestionId: row.suggestionId,
				title: row.title,
				year: row.year,
				posterUrl: row.posterUrl,
				runtime: row.runtime,
				mine: row.suggestedBy === viewerId,
				status: row.status as 'open' | 'drawn',
				night:
					row.status === 'drawn' && row.nightAt
						? { scheduledAt: row.nightAt, watched: row.nightStatus === 'watched' }
						: null
			}))
	);
}
