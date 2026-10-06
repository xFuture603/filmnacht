import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import {
	drawFrom,
	newSeed,
	FAIRNESS_WINDOW_NIGHTS,
	type Candidate,
	type DrawLogEntry
} from './draw';
import type { DB } from './db/client';
import {
	attendance,
	groups,
	memberships,
	movieNights,
	movies,
	suggestions,
	users,
	type GroupSettings
} from './db/schema';
import { groupSettings } from './group-settings';
import { requireMember, requireOwner } from './groups';
import { FORMER_MEMBER_USERNAME } from './members';

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
	/** The drawn film's suggester has left and been replaced by the placeholder. */
	drawnByFormer: boolean;
	/** The latest draw had exactly one film to choose from: no dice were rolled (§6). */
	onlyCandidate: boolean;
	/** The one permitted re-draw has been used (§6). */
	redrawUsed: boolean;
	/** The latest draw's log entry has `by: null`: the scheduler drew it, not the owner. */
	drawnAutomatically: boolean;
	myResponse: 'yes' | 'no' | 'maybe' | null;
	responses: Array<{ displayName: string; response: 'yes' | 'no' | 'maybe' }>;
};

export type DrawOutcome =
	| { ok: true; suggestionId: string; title: string; onlyCandidate: boolean }
	| {
			ok: false;
			reason: 'not_found' | 'not_scheduled' | 'no_candidates' | 'redraw_used' | 'sole_suggestion';
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
			drawnByUsername: users.username,
			drawLog: movieNights.drawLog,
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

	// Derived from the log rather than stored: `onlyCandidate` is a fact about
	// the latest draw, and the log is where that draw is recorded. The log itself
	// (user ids, weights, seed) is not handed to the page.
	const { drawLog, drawnByUsername, ...rest } = night;
	const log = (drawLog as DrawLogEntry[] | null) ?? [];
	const latest = log.at(-1);
	return {
		...rest,
		drawnByFormer: drawnByUsername === FORMER_MEMBER_USERNAME,
		onlyCandidate:
			latest !== undefined &&
			latest.candidates.length === 1 &&
			latest.candidates[0].suggestions === 1,
		redrawUsed: log.length >= 2,
		drawnAutomatically: latest !== undefined && latest.by === null,
		myResponse: myResponseRow?.response ?? null,
		responses
	};
}

/**
 * The people who can take a turn, with how many of their films the group has
 * WATCHED inside the window.
 *
 * Membership is joined, not assumed: a suggestion whose author has left the
 * group, or is the former-member placeholder, or is a wildcard (`suggested_by
 * IS NULL`), stays in the pool as history and cannot win. The draw draws
 * people, and those are not people who can take a turn.
 */
export function candidatesFor(db: DB, groupId: string): Candidate[] {
	// The window is the last N nights this group actually WATCHED. Drawn and
	// cancelled nights are absent by construction, which is what stops a
	// cancelled night or a re-draw from costing somebody their turn (PRD §6).
	const watchedNightIds = db
		.select({ suggestionId: movieNights.suggestionId })
		.from(movieNights)
		.where(and(eq(movieNights.groupId, groupId), eq(movieNights.status, 'watched')))
		.orderBy(desc(movieNights.scheduledAt))
		.limit(FAIRNESS_WINDOW_NIGHTS)
		.all()
		.map((r) => r.suggestionId)
		.filter((id): id is string => id !== null);

	const watchedBy = new Map<string, number>();
	if (watchedNightIds.length > 0) {
		for (const row of db
			.select({ userId: suggestions.suggestedBy })
			.from(suggestions)
			.where(inArray(suggestions.id, watchedNightIds))
			.all()) {
			if (row.userId) watchedBy.set(row.userId, (watchedBy.get(row.userId) ?? 0) + 1);
		}
	}

	const open = db
		.select({ suggestionId: suggestions.id, userId: suggestions.suggestedBy })
		.from(suggestions)
		.innerJoin(
			memberships,
			and(eq(memberships.userId, suggestions.suggestedBy), eq(memberships.groupId, groupId))
		)
		.where(
			and(
				eq(suggestions.groupId, groupId),
				eq(suggestions.status, 'open'),
				isNull(memberships.leftAt)
			)
		)
		// A fixed order, so a logged seed replays stage 2 to the same film.
		.orderBy(suggestions.id)
		.all();

	const byUser = new Map<string, string[]>();
	for (const row of open) {
		if (!row.userId) continue;
		byUser.set(row.userId, [...(byUser.get(row.userId) ?? []), row.suggestionId]);
	}

	return [...byUser].map(([userId, suggestionIds]) => ({
		userId,
		suggestionIds,
		watchedInWindow: watchedBy.get(userId) ?? 0
	}));
}

/**
 * Synchronous on purpose. The candidate reads and `drawFrom` run before the
 * transaction; only the claim-and-write is inside it. That is safe because
 * nothing here awaits and better-sqlite3 is one connection: no other request
 * can run between the reads and the claim, and the claim's own WHERE refuses a
 * night that is no longer 'scheduled', so two owners pressing Draw at the same
 * moment produce one result. This project has fixed read-yield-write on a stale
 * read four times; if a future change wants to await in here, that is the
 * signal to stop rather than to make this async.
 *
 * `excludeSuggestionId` is the film a re-draw just released (R12): it goes back
 * to the pool for later nights, but not into this night's second draw.
 *
 * No authorization: `by` is recorded as given, `null` meaning the automatic
 * scheduler rather than an owner. `drawForNight` below is the owner-checked
 * entry point the route and `redraw` use; this one is for the scheduler.
 */
export function drawNight(
	db: DB,
	nightId: string,
	by: string | null,
	excludeSuggestionId?: string | null
): DrawOutcome {
	const night = db
		.select({ groupId: movieNights.groupId })
		.from(movieNights)
		.where(eq(movieNights.id, nightId))
		.get();
	if (!night) return { ok: false, reason: 'not_found' };
	const settings = groupSettings(
		db.select({ settings: groups.settings }).from(groups).where(eq(groups.id, night.groupId)).get()
			?.settings
	);

	const candidates = candidatesFor(db, night.groupId)
		.map((c) => ({
			...c,
			suggestionIds: c.suggestionIds.filter((id) => id !== excludeSuggestionId)
		}))
		.filter((c) => c.suggestionIds.length > 0);
	if (candidates.length === 0) return { ok: false, reason: 'no_candidates' };

	const seed = newSeed();
	const picked = drawFrom(candidates, settings.drawMode, seed);
	if (!picked) return { ok: false, reason: 'no_candidates' };

	return db.transaction(() => {
		// Test-and-set, not read-then-write: the UPDATE's own WHERE is the guard,
		// so a second caller that got this far finds nothing to update.
		const claimed = db
			.update(movieNights)
			.set({
				status: 'drawn',
				suggestionId: picked.suggestionId,
				drawnAt: new Date(),
				drawSeed: String(seed)
			})
			.where(and(eq(movieNights.id, nightId), eq(movieNights.status, 'scheduled')))
			.run();
		if (claimed.changes === 0) return { ok: false, reason: 'not_scheduled' } as const;

		db.update(suggestions)
			.set({ status: 'drawn' })
			.where(eq(suggestions.id, picked.suggestionId))
			.run();

		const entry: DrawLogEntry = {
			at: new Date().toISOString(),
			seed,
			by,
			mode: settings.drawMode,
			candidates: picked.candidates,
			pickedUserId: picked.userId,
			pickedSuggestionId: picked.suggestionId
		};
		appendDrawLog(db, nightId, entry);

		const title =
			db
				.select({ title: movies.title })
				.from(suggestions)
				.innerJoin(movies, eq(movies.id, suggestions.movieId))
				.where(eq(suggestions.id, picked.suggestionId))
				.get()?.title ?? '';

		return {
			ok: true,
			suggestionId: picked.suggestionId,
			title,
			onlyCandidate: candidates.length === 1 && candidates[0].suggestionIds.length === 1
		} as const;
	});
}

/** Owner-checked entry point: looks the night up, then delegates to `drawNight`. */
export function drawForNight(
	db: DB,
	nightId: string,
	ownerId: string,
	excludeSuggestionId?: string | null
): DrawOutcome {
	const night = db
		.select({ groupId: movieNights.groupId })
		.from(movieNights)
		.where(eq(movieNights.id, nightId))
		.get();
	if (!night) return { ok: false, reason: 'not_found' };
	requireOwner(db, ownerId, night.groupId);
	return drawNight(db, nightId, ownerId, excludeSuggestionId);
}

/**
 * Allowed from 'scheduled' or 'drawn'; releases the drawn film, if any, back
 * to 'open'. Refused from 'watched' or 'cancelled' — a watched night's film
 * must never re-enter the pool, or its author would wrongly get the turn
 * back that the fairness window already credited them for.
 */
export function cancelNight(db: DB, nightId: string, ownerId: string): boolean {
	const night = db
		.select({ groupId: movieNights.groupId, suggestionId: movieNights.suggestionId })
		.from(movieNights)
		.where(eq(movieNights.id, nightId))
		.get();
	if (!night) return false;
	requireOwner(db, ownerId, night.groupId);

	return db.transaction(() => {
		// Test-and-set: only a night still in 'scheduled' or 'drawn' claims this.
		const claimed = db
			.update(movieNights)
			.set({ status: 'cancelled' })
			.where(and(eq(movieNights.id, nightId), inArray(movieNights.status, ['scheduled', 'drawn'])))
			.run();
		if (claimed.changes === 0) return false;

		if (night.suggestionId) {
			db.update(suggestions)
				.set({ status: 'open' })
				.where(eq(suggestions.id, night.suggestionId))
				.run();
		}
		return true;
	});
}

/** Only from 'drawn'. Manual on purpose — PRD §6 defers the automatic move to v1.0. */
export function markWatched(db: DB, nightId: string, ownerId: string): boolean {
	const night = db
		.select({ groupId: movieNights.groupId })
		.from(movieNights)
		.where(eq(movieNights.id, nightId))
		.get();
	if (!night) return false;
	requireOwner(db, ownerId, night.groupId);

	return db.transaction(() => {
		const claimed = db
			.update(movieNights)
			.set({ status: 'watched', watchedAt: new Date() })
			.where(and(eq(movieNights.id, nightId), eq(movieNights.status, 'drawn')))
			.run();
		return claimed.changes > 0;
	});
}

/** Private sentinel for redraw's all-or-nothing rollback (R3). Never escapes redraw. */
class RedrawAbort extends Error {
	constructor(readonly outcome: Extract<DrawOutcome, { ok: false }>) {
		super('redraw aborted');
	}
}

/**
 * Permitted exactly once per night (PRD §6): more than one existing log entry
 * means the override is spent. Keeps one implementation of "pick a film"
 * rather than two that can drift — it releases the drawn suggestion, puts the
 * night back to 'scheduled', and calls `drawForNight` unchanged.
 *
 * Everything, including the permission and status checks, runs inside one
 * transaction. If any step after the release fails, it throws the private
 * `RedrawAbort` sentinel, which unwinds the transaction (Drizzle rolls back on
 * any throw) so a failed re-draw leaves the night exactly as it was: 'drawn',
 * same film, log untouched.
 */
export function redraw(db: DB, nightId: string, ownerId: string): DrawOutcome {
	try {
		return db.transaction(() => {
			const night = db
				.select({
					groupId: movieNights.groupId,
					status: movieNights.status,
					suggestionId: movieNights.suggestionId,
					drawLog: movieNights.drawLog
				})
				.from(movieNights)
				.where(eq(movieNights.id, nightId))
				.get();
			if (!night) throw new RedrawAbort({ ok: false, reason: 'not_found' });

			requireOwner(db, ownerId, night.groupId);

			// Only a night with a drawn film can be re-drawn. Reusing 'not_scheduled'
			// rather than adding a reason: it already means "not in the state this
			// transition needs," which is exactly what this is.
			if (night.status !== 'drawn') {
				throw new RedrawAbort({ ok: false, reason: 'not_scheduled' });
			}

			const log = (night.drawLog as DrawLogEntry[] | null) ?? [];
			if (log.length >= 2) {
				throw new RedrawAbort({ ok: false, reason: 'redraw_used' });
			}

			if (night.suggestionId) {
				db.update(suggestions)
					.set({ status: 'open' })
					.where(eq(suggestions.id, night.suggestionId))
					.run();
			}

			// Test-and-set, same guard as drawForNight's own claim.
			const claimed = db
				.update(movieNights)
				.set({ status: 'scheduled' })
				.where(and(eq(movieNights.id, nightId), eq(movieNights.status, 'drawn')))
				.run();
			if (claimed.changes === 0) {
				throw new RedrawAbort({ ok: false, reason: 'not_scheduled' });
			}

			// Evaluated AFTER releasing the film, and without it: the re-draw never
			// returns the film it just released (R12), so with no OTHER open film
			// there is nothing to draw (Review Focus 4).
			const others = candidatesFor(db, night.groupId)
				.flatMap((c) => c.suggestionIds)
				.filter((id) => id !== night.suggestionId);
			if (others.length === 0) {
				throw new RedrawAbort({ ok: false, reason: 'sole_suggestion' });
			}

			const outcome = drawForNight(db, nightId, ownerId, night.suggestionId);
			if (!outcome.ok) throw new RedrawAbort(outcome);
			return outcome;
		});
	} catch (err) {
		if (err instanceof RedrawAbort) return err.outcome;
		throw err;
	}
}

/** Appends. Never overwrites — a re-draw must leave the first result readable. */
function appendDrawLog(db: DB, nightId: string, entry: DrawLogEntry): void {
	const existing =
		(db
			.select({ log: movieNights.drawLog })
			.from(movieNights)
			.where(eq(movieNights.id, nightId))
			.get()?.log as DrawLogEntry[] | null) ?? [];
	db.update(movieNights)
		.set({ drawLog: [...existing, entry] })
		.where(eq(movieNights.id, nightId))
		.run();
}

/**
 * `resultVisible: 'on_night'` keeps the drawn film a surprise until the night
 * starts. Everything that could name the film has to ask this first — the
 * night page and the pool alike — because a title withheld in one place and
 * shown in another is not withheld.
 */
export function isResultVisible(
	settings: GroupSettings,
	night: { status: string; scheduledAt: Date },
	now: Date
): boolean {
	return (
		settings.resultVisible === 'immediately' ||
		// Watched means everyone has seen it: there is no surprise left to keep.
		night.status === 'watched' ||
		now.getTime() >= night.scheduledAt.getTime()
	);
}

export type NextNight = {
	id: string;
	scheduledAt: Date;
	location: string | null;
	status: 'scheduled' | 'drawn';
	myResponse: 'yes' | 'no' | 'maybe' | null;
	film: { title: string; year: number | null; posterUrl: string | null } | null;
	/** A film is drawn, but the group keeps it a surprise until the night starts. */
	filmHidden: boolean;
};

/**
 * The night the group's start page puts first: the soonest one that is neither
 * cancelled nor over. A night stays "next" while it is under way, until
 * `nightEndsAfterMinutes` after its start, so it does not vanish at 20:01.
 * The film is left out, not just unflagged, while it is still a surprise.
 */
export function nextNight(
	db: DB,
	groupId: string,
	viewerId: string,
	settings: GroupSettings,
	now: Date
): NextNight | null {
	const lasts = settings.nightEndsAfterMinutes * 60_000;
	const night = db
		.select({
			id: movieNights.id,
			scheduledAt: movieNights.scheduledAt,
			location: movieNights.location,
			status: movieNights.status,
			title: movies.title,
			year: movies.year,
			posterUrl: movies.posterUrl
		})
		.from(movieNights)
		.leftJoin(suggestions, eq(suggestions.id, movieNights.suggestionId))
		.leftJoin(movies, eq(movies.id, suggestions.movieId))
		.where(
			and(eq(movieNights.groupId, groupId), inArray(movieNights.status, ['scheduled', 'drawn']))
		)
		.orderBy(movieNights.scheduledAt)
		.all()
		.find((n) => n.scheduledAt.getTime() + lasts > now.getTime());
	if (!night) return null;

	const mine = db
		.select({ response: attendance.response })
		.from(attendance)
		.where(and(eq(attendance.movieNightId, night.id), eq(attendance.userId, viewerId)))
		.get();
	const drawn = night.status === 'drawn' && night.title !== null;
	const visible = isResultVisible(settings, night, now);
	return {
		id: night.id,
		scheduledAt: night.scheduledAt,
		location: night.location,
		status: night.status as 'scheduled' | 'drawn',
		myResponse: mine?.response ?? null,
		film:
			drawn && visible
				? { title: night.title as string, year: night.year, posterUrl: night.posterUrl }
				: null,
		filmHidden: drawn && !visible
	};
}

/** Suggestions drawn for a night that has not started yet. A night watched early is no secret. */
export function unrevealedDrawnIds(db: DB, groupId: string, now: Date): Set<string> {
	return new Set(
		db
			.select({ suggestionId: movieNights.suggestionId, scheduledAt: movieNights.scheduledAt })
			.from(movieNights)
			.where(and(eq(movieNights.groupId, groupId), eq(movieNights.status, 'drawn')))
			.all()
			.filter((n) => n.suggestionId !== null && n.scheduledAt.getTime() > now.getTime())
			.map((n) => n.suggestionId as string)
	);
}
