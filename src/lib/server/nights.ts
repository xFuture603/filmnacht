import { and, desc, eq, sql } from 'drizzle-orm';
import type { DB } from './db/client';
import { attendance, movieNights, movies, suggestions, users } from './db/schema';
import { requireMember, requireOwner } from './groups';

/**
 * PRD §6 says "the owner (optionally any member, per setting)" may schedule a
 * night. `GroupSettings` has no such setting and adding one is not in scope
 * here — the owner schedules, full stop, and the per-member variant is
 * deferred rather than guessed at.
 *
 * RSVP does not affect the draw: answering "no" still leaves a member's
 * suggestions in the running. §6 never ties attendance to eligibility, and
 * coupling them would let someone improve their draw odds by declining.
 */

export const LOCATION_MAX = 120;

export type NightSummary = {
	id: string;
	scheduledAt: Date;
	location: string | null;
	status: 'scheduled' | 'drawn' | 'watched' | 'cancelled';
	yes: number;
	no: number;
	maybe: number;
};

export type NightDetail = NightSummary & {
	groupId: string;
	drawnTitle: string | null;
	drawnBy: string | null;
	myResponse: 'yes' | 'no' | 'maybe' | null;
	responses: Array<{ displayName: string; response: 'yes' | 'no' | 'maybe' }>;
};

export function scheduleNight(
	db: DB,
	input: { groupId: string; userId: string; scheduledAt: Date; location: string | null }
): string {
	// Authorization before anything else touches or reveals state.
	requireOwner(db, input.userId, input.groupId);

	const location = input.location?.trim() || null;
	if (location && location.length > LOCATION_MAX) {
		throw new Error(`location exceeds ${LOCATION_MAX} characters`);
	}
	if (!Number.isFinite(input.scheduledAt.getTime())) {
		throw new Error('scheduledAt is not a usable date');
	}

	const id = crypto.randomUUID();
	db.insert(movieNights)
		.values({ id, groupId: input.groupId, scheduledAt: input.scheduledAt, location })
		.run();
	return id;
}

export function respond(
	db: DB,
	nightId: string,
	userId: string,
	response: 'yes' | 'no' | 'maybe'
): void {
	const night = db
		.select({ groupId: movieNights.groupId })
		.from(movieNights)
		.where(eq(movieNights.id, nightId))
		.get();
	if (!night) throw new Error('no such night');
	// Membership is the authorization, and it is checked against the night's own
	// group rather than one supplied by the caller.
	requireMember(db, userId, night.groupId);

	// One row per (night, member): the unique index makes this an upsert rather
	// than letting a second click add a second answer.
	db.insert(attendance)
		.values({ id: crypto.randomUUID(), movieNightId: nightId, userId, response })
		.onConflictDoUpdate({
			target: [attendance.movieNightId, attendance.userId],
			set: { response }
		})
		.run();
}

// Shared by listNights and nightDetail: a correlated subquery per response
// keeps the whole thing one statement. At a dozen nights per group the shape
// matters less than its readability.
//
// The table/column names below are written as raw SQL text rather than
// interpolated Drizzle column objects: `${movieNights.id}` renders
// unqualified ("id") outside of a join, and inside this subquery's own FROM
// attendance — which also has an "id" column — that resolves to
// attendance.id instead of the correlated outer row, silently matching
// nothing. Fully-qualified literal names sidestep that ambiguity.
function responseCount(response: 'yes' | 'no' | 'maybe') {
	return sql<number>`(
		select count(*) from attendance
		where attendance.movie_night_id = movie_nights.id
		and attendance.response = ${response}
	)`;
}

export function listNights(db: DB, groupId: string): NightSummary[] {
	return db
		.select({
			id: movieNights.id,
			scheduledAt: movieNights.scheduledAt,
			location: movieNights.location,
			status: movieNights.status,
			yes: responseCount('yes'),
			no: responseCount('no'),
			maybe: responseCount('maybe')
		})
		.from(movieNights)
		.where(eq(movieNights.groupId, groupId))
		.orderBy(desc(movieNights.scheduledAt))
		.all();
}

/**
 * Returns `null` when the night does not exist **or** the viewer is not a
 * member — the same answer for both, so a non-member cannot distinguish a
 * group they may not see from a night that never existed.
 */
export function nightDetail(db: DB, nightId: string, viewerId: string): NightDetail | null {
	const night = db
		.select({
			id: movieNights.id,
			groupId: movieNights.groupId,
			scheduledAt: movieNights.scheduledAt,
			location: movieNights.location,
			status: movieNights.status,
			drawnTitle: movies.title,
			drawnBy: users.displayName,
			yes: responseCount('yes'),
			no: responseCount('no'),
			maybe: responseCount('maybe')
		})
		.from(movieNights)
		.leftJoin(suggestions, eq(suggestions.id, movieNights.suggestionId))
		.leftJoin(movies, eq(movies.id, suggestions.movieId))
		.leftJoin(users, eq(users.id, suggestions.suggestedBy))
		.where(eq(movieNights.id, nightId))
		.get();
	if (!night) return null;

	// Membership check happens after the row is fetched but before anything
	// about it is returned, so both "no such night" and "not your group" reach
	// this same null.
	try {
		requireMember(db, viewerId, night.groupId);
	} catch {
		return null;
	}

	const responses = db
		.select({ displayName: users.displayName, response: attendance.response })
		.from(attendance)
		.innerJoin(users, eq(users.id, attendance.userId))
		.where(eq(attendance.movieNightId, nightId))
		.all();

	const myResponseRow = db
		.select({ response: attendance.response })
		.from(attendance)
		.where(and(eq(attendance.movieNightId, nightId), eq(attendance.userId, viewerId)))
		.get();

	return {
		...night,
		myResponse: myResponseRow?.response ?? null,
		responses
	};
}
