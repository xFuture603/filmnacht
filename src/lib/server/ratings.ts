import { and, eq, inArray, isNull } from 'drizzle-orm';
import type { DB } from './db/client';
import {
	attendance,
	memberships,
	movieNights,
	movies,
	ratings,
	suggestions,
	users,
	type GroupSettings
} from './db/schema';
import { requireMember, requireOwner } from './groups';
import { FORMER_MEMBER_USERNAME } from './members';

/** PRD §7: an optional comment of at most 500 characters. Longer is refused, not clipped. */
export const COMMENT_MAX = 500;

const MINUTE = 60 * 1000;
const DAY = 24 * 60 * MINUTE;

export type RatingWindow =
	| { state: 'not_ratable' }
	| { state: 'before'; opensAt: Date }
	| { state: 'open'; closesAt: Date }
	| { state: 'closed'; closedAt: Date };

/**
 * Computed on read from the clock and the group's settings (PRD §7): no job
 * opens or closes anything. A night with no film to rate never opens.
 */
export function ratingWindow(
	night: { status: string; scheduledAt: Date },
	settings: GroupSettings,
	now: Date
): RatingWindow {
	if (night.status !== 'drawn' && night.status !== 'watched') return { state: 'not_ratable' };
	const opensAt = new Date(night.scheduledAt.getTime() + settings.nightEndsAfterMinutes * MINUTE);
	const closesAt = new Date(opensAt.getTime() + settings.ratingWindowDays * DAY);
	if (now < opensAt) return { state: 'before', opensAt };
	if (now < closesAt) return { state: 'open', closesAt };
	return { state: 'closed', closedAt: closesAt };
}

/** "7.5" → 15. Anything but a half step from 1 to 10 is null (PRD §7 stores 2–20). */
export function parseScore(raw: FormDataEntryValue | null): number | null {
	if (typeof raw !== 'string' || raw.trim() === '') return null;
	const doubled = Number(raw) * 2;
	return Number.isInteger(doubled) && doubled >= 2 && doubled <= 20 ? doubled : null;
}

type NightRow = {
	groupId: string;
	status: string;
	scheduledAt: Date;
	revealedAt: Date | null;
};

function nightRow(db: DB, nightId: string): NightRow | undefined {
	return db
		.select({
			groupId: movieNights.groupId,
			status: movieNights.status,
			scheduledAt: movieNights.scheduledAt,
			revealedAt: movieNights.revealedAt
		})
		.from(movieNights)
		.where(eq(movieNights.id, nightId))
		.get();
}

/** Stored reveal, or the window having closed. Both only ever move one way. */
function isRevealed(night: NightRow, settings: GroupSettings, now: Date): boolean {
	return night.revealedAt !== null || ratingWindow(night, settings, now).state === 'closed';
}

function myRating(db: DB, nightId: string, userId: string) {
	return db
		.select({ id: ratings.id, scoreX2: ratings.scoreX2, comment: ratings.comment })
		.from(ratings)
		.where(and(eq(ratings.movieNightId, nightId), eq(ratings.userId, userId)))
		.get();
}

/**
 * Current members who answered "I'm in" and have no rating yet. The automatic
 * reveal waits for exactly these people; somebody who left is not waited for.
 */
function waitingIds(db: DB, nightId: string, groupId: string): { yes: number; missing: string[] } {
	const yes = db
		.select({ userId: attendance.userId })
		.from(attendance)
		.innerJoin(
			memberships,
			and(eq(memberships.userId, attendance.userId), eq(memberships.groupId, groupId))
		)
		.where(
			and(
				eq(attendance.movieNightId, nightId),
				eq(attendance.response, 'yes'),
				isNull(memberships.leftAt)
			)
		)
		.all()
		.map((r) => r.userId);
	const rated = new Set(
		db
			.select({ userId: ratings.userId })
			.from(ratings)
			.where(eq(ratings.movieNightId, nightId))
			.all()
			.map((r) => r.userId)
	);
	return { yes: yes.length, missing: yes.filter((id) => !rated.has(id)) };
}

/** Sets revealed_at unless it is already set. Never overwrites a reveal. */
function stampReveal(db: DB, nightId: string, now: Date): boolean {
	return (
		db
			.update(movieNights)
			.set({ revealedAt: now })
			.where(and(eq(movieNights.id, nightId), isNull(movieNights.revealedAt)))
			.run().changes > 0
	);
}

export function saveRating(
	db: DB,
	input: { nightId: string; userId: string; scoreX2: number; comment: string | null; now: Date }
):
	| { ok: true; revealed: boolean }
	| { ok: false; reason: 'not_found' | 'window' | 'locked' | 'score' | 'comment' } {
	const night = nightRow(db, input.nightId);
	if (!night) return { ok: false, reason: 'not_found' };
	// Authorization before anything else is read or written.
	const { settings } = requireMember(db, input.userId, night.groupId);

	if (ratingWindow(night, settings, input.now).state !== 'open')
		return { ok: false, reason: 'window' };
	if (!Number.isInteger(input.scoreX2) || input.scoreX2 < 2 || input.scoreX2 > 20) {
		return { ok: false, reason: 'score' };
	}
	const comment = input.comment?.trim() || null;
	if (comment && comment.length > COMMENT_MAX) return { ok: false, reason: 'comment' };

	return db.transaction(() => {
		// Re-read inside the transaction: this, not the pre-transaction `night`
		// above, is the revealed_at the lock check and the reveal decision below
		// must act on.
		const revealedAt = nightRow(db, input.nightId)?.revealedAt ?? null;
		const existing = myRating(db, input.nightId, input.userId);
		if (existing && revealedAt !== null) {
			// A resubmit of the exact same score and comment (e.g. a double click)
			// is not a lock violation: nothing would actually change.
			if (existing.scoreX2 === input.scoreX2 && existing.comment === comment) {
				return { ok: true, revealed: true } as const;
			}
			return { ok: false, reason: 'locked' } as const;
		}

		// One rating per (night, member), enforced here rather than by a unique
		// index (R2): the former-member placeholder is one row shared by every
		// departed rater, so an index on (movie_night_id, user_id) would make a
		// second departed rater's reassignment collide with the first's on a
		// night they both rated.
		if (existing) {
			db.update(ratings)
				.set({ scoreX2: input.scoreX2, comment })
				.where(eq(ratings.id, existing.id))
				.run();
		} else {
			db.insert(ratings)
				.values({
					id: crypto.randomUUID(),
					movieNightId: input.nightId,
					userId: input.userId,
					scoreX2: input.scoreX2,
					comment
				})
				.run();
		}

		// People rating the film is proof it was watched: the fairness window
		// must count it even if nobody pressed "We watched it". Same test-and-set
		// as markWatched.
		db.update(movieNights)
			.set({ status: 'watched' })
			.where(and(eq(movieNights.id, input.nightId), eq(movieNights.status, 'drawn')))
			.run();

		if (revealedAt === null) {
			const { yes, missing } = waitingIds(db, input.nightId, night.groupId);
			// With nobody "in", the first rating would otherwise reveal itself.
			if (yes > 0 && missing.length === 0) stampReveal(db, input.nightId, input.now);
		}
		const after = nightRow(db, input.nightId);
		return {
			ok: true,
			revealed: after !== undefined && isRevealed(after, settings, input.now)
		} as const;
	});
}

export function withdrawRating(
	db: DB,
	input: { nightId: string; userId: string; now: Date }
): 'ok' | 'not_found' | 'window' | 'locked' {
	const night = nightRow(db, input.nightId);
	if (!night) return 'not_found';
	const { settings } = requireMember(db, input.userId, night.groupId);
	if (ratingWindow(night, settings, input.now).state !== 'open') return 'window';
	return db.transaction(() => {
		if (!myRating(db, input.nightId, input.userId)) return 'not_found' as const;
		// Re-read inside the transaction, not the pre-transaction `night` above.
		const revealedAt = nightRow(db, input.nightId)?.revealedAt ?? null;
		if (revealedAt !== null) return 'locked' as const;
		db.delete(ratings)
			.where(and(eq(ratings.movieNightId, input.nightId), eq(ratings.userId, input.userId)))
			.run();
		return 'ok' as const;
	});
}

export function revealNow(
	db: DB,
	input: { nightId: string; ownerId: string; now: Date }
): 'ok' | 'not_found' | 'window' | 'no_ratings' | 'already' {
	const night = nightRow(db, input.nightId);
	if (!night) return 'not_found';
	const { settings } = requireOwner(db, input.ownerId, night.groupId);
	const window = ratingWindow(night, settings, input.now).state;
	if (window !== 'open' && window !== 'closed') return 'window';
	return db.transaction(() => {
		const any = db
			.select({ id: ratings.id })
			.from(ratings)
			.where(eq(ratings.movieNightId, input.nightId))
			.get();
		if (!any) return 'no_ratings' as const;
		// A closed window is already revealed (isRevealed treats it as such
		// regardless of the stored timestamp) — stamping it now would record a
		// revealed_at long after the reveal actually happened.
		if (window === 'closed') return 'already' as const;
		return stampReveal(db, input.nightId, input.now) ? ('ok' as const) : ('already' as const);
	});
}

export type RatingView = {
	window: RatingWindow;
	revealed: boolean;
	mine: { score: number; comment: string | null } | null;
	count: number;
	rated: string[];
	waitingFor: string[];
	results: null | {
		average: number;
		lowest: { score: number; names: string[] };
		highest: { score: number; names: string[] };
		tmdb: { rating: number; delta: number } | null;
		ratings: Array<{ name: string; score: number; comment: string | null }>;
	};
};

/**
 * What ONE viewer may know about a night's ratings. Before the reveal that is
 * their own rating, how many are in and who — never another member's score or
 * comment. This is the payload, not a hint to the markup (PRD §7).
 */
export function ratingView(
	db: DB,
	nightId: string,
	viewerId: string,
	now: Date,
	formerLabel: string
): RatingView | null {
	const night = nightRow(db, nightId);
	if (!night) return null;
	let settings: GroupSettings;
	try {
		settings = requireMember(db, viewerId, night.groupId).settings;
	} catch {
		return null;
	}

	const rows = db
		.select({
			userId: ratings.userId,
			scoreX2: ratings.scoreX2,
			comment: ratings.comment,
			displayName: users.displayName,
			username: users.username
		})
		.from(ratings)
		.leftJoin(users, eq(users.id, ratings.userId))
		.where(eq(ratings.movieNightId, nightId))
		.orderBy(ratings.createdAt, ratings.id)
		.all();
	const nameOf = (r: (typeof rows)[number]) =>
		r.username === FORMER_MEMBER_USERNAME ? formerLabel : (r.displayName ?? formerLabel);

	const revealed = isRevealed(night, settings, now);
	const mineRow = rows.find((r) => r.userId === viewerId);
	const { missing } = waitingIds(db, nightId, night.groupId);
	const names = new Map(
		missing.length === 0
			? []
			: db
					.select({ id: users.id, name: users.displayName })
					.from(users)
					.where(inArray(users.id, missing))
					.all()
					.map((u) => [u.id, u.name] as const)
	);

	let results: RatingView['results'] = null;
	if (revealed && rows.length > 0) {
		const scores = rows.map((r) => r.scoreX2);
		const min = Math.min(...scores);
		const max = Math.max(...scores);
		const average = scores.reduce((a, b) => a + b, 0) / scores.length / 2;
		const tmdbRating = db
			.select({ rating: movies.tmdbRating })
			.from(movieNights)
			.innerJoin(suggestions, eq(suggestions.id, movieNights.suggestionId))
			.innerJoin(movies, eq(movies.id, suggestions.movieId))
			.where(eq(movieNights.id, nightId))
			.get()?.rating;
		results = {
			average,
			lowest: {
				score: min / 2,
				names: rows
					.filter((r) => r.scoreX2 === min)
					.map(nameOf)
					.sort()
			},
			highest: {
				score: max / 2,
				names: rows
					.filter((r) => r.scoreX2 === max)
					.map(nameOf)
					.sort()
			},
			tmdb: tmdbRating == null ? null : { rating: tmdbRating, delta: average - tmdbRating },
			ratings: rows.map((r) => ({ name: nameOf(r), score: r.scoreX2 / 2, comment: r.comment }))
		};
	}

	return {
		window: ratingWindow(night, settings, now),
		revealed,
		mine: mineRow ? { score: mineRow.scoreX2 / 2, comment: mineRow.comment } : null,
		count: rows.length,
		rated: rows.map(nameOf),
		waitingFor: missing.map((id) => names.get(id) ?? formerLabel).sort(),
		results
	};
}

/** Night id → average (1–10), for the nights list. Only revealed nights appear. */
export function averagesFor(
	db: DB,
	groupId: string,
	settings: GroupSettings,
	now: Date
): Map<string, number> {
	const nights = db
		.select({
			id: movieNights.id,
			groupId: movieNights.groupId,
			status: movieNights.status,
			scheduledAt: movieNights.scheduledAt,
			revealedAt: movieNights.revealedAt
		})
		.from(movieNights)
		.where(eq(movieNights.groupId, groupId))
		.all()
		.filter((n) => isRevealed(n, settings, now));
	const out = new Map<string, number>();
	if (nights.length === 0) return out;
	const rows = db
		.select({ nightId: ratings.movieNightId, scoreX2: ratings.scoreX2 })
		.from(ratings)
		.where(
			inArray(
				ratings.movieNightId,
				nights.map((n) => n.id)
			)
		)
		.all();
	for (const n of nights) {
		const scores = rows.filter((r) => r.nightId === n.id).map((r) => r.scoreX2);
		if (scores.length > 0) out.set(n.id, scores.reduce((a, b) => a + b, 0) / scores.length / 2);
	}
	return out;
}
