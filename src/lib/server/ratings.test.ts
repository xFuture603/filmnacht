import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { applyMigrations, createDb, type DB } from '$lib/server/db/client';
import { DEFAULT_GROUP_SETTINGS, movieNights, movies, ratings } from '$lib/server/db/schema';
import { addMember, createGroup, leaveGroup } from '$lib/server/groups';
import { candidatesFor, drawForNight, respond, scheduleNight } from '$lib/server/nights';
import { addSuggestion } from '$lib/server/suggestions';
import { createUser } from '$lib/server/users';
import {
	COMMENT_MAX,
	averagesFor,
	parseScore,
	ratingView,
	ratingWindow,
	revealNow,
	saveRating,
	withdrawRating
} from './ratings';

let db: DB;
let ada: string; // owner
let grace: string;
let alan: string;
let groupId: string;
let nightId: string;

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const START = new Date('2030-03-01T19:00:00Z');
// DEFAULT_GROUP_SETTINGS: nightEndsAfterMinutes 180, ratingWindowDays 7.
const OPENS = new Date(START.getTime() + 3 * HOUR);
const CLOSES = new Date(OPENS.getTime() + 7 * DAY);
const DURING = new Date(OPENS.getTime() + HOUR);

function person(username: string) {
	return createUser(db, {
		username,
		displayName: username[0].toUpperCase() + username.slice(1),
		passwordHash: 'x'
	}).id;
}

function rate(userId: string, score: number, comment: string | null = null, now = DURING) {
	return saveRating(db, { nightId, userId, scoreX2: score * 2, comment, now });
}

beforeEach(() => {
	db = createDb(':memory:').db;
	applyMigrations(db);
	ada = person('ada');
	grace = person('grace');
	alan = person('alan');
	groupId = createGroup(db, { name: 'Filmnacht', ownerId: ada });
	addMember(db, grace, groupId);
	addMember(db, alan, groupId);
	addSuggestion(db, {
		groupId,
		userId: grace,
		movie: { title: 'Dune', tmdbRating: 8.0 },
		settings: DEFAULT_GROUP_SETTINGS
	});
	// scheduleNight has no past check; START is in the past relative to the fixed `now`s.
	nightId = scheduleNight(db, { groupId, userId: ada, scheduledAt: START, location: null });
	drawForNight(db, nightId, ada);
});

describe('parseScore', () => {
	it('doubles half steps into the stored integer', () => {
		expect(parseScore('1')).toBe(2);
		expect(parseScore('7.5')).toBe(15);
		expect(parseScore('10')).toBe(20);
	});

	it('refuses anything that is not a half step from 1 to 10', () => {
		for (const bad of ['', 'abc', '7.25', '0.5', '10.5', '0', '-1', null, 'Infinity']) {
			expect(parseScore(bad)).toBeNull();
		}
	});
});

describe('ratingWindow', () => {
	const night = { status: 'drawn', scheduledAt: START };

	it('opens when the night ends and closes after the window', () => {
		expect(ratingWindow(night, DEFAULT_GROUP_SETTINGS, new Date(OPENS.getTime() - 1000))).toEqual({
			state: 'before',
			opensAt: OPENS
		});
		expect(ratingWindow(night, DEFAULT_GROUP_SETTINGS, OPENS)).toEqual({
			state: 'open',
			closesAt: CLOSES
		});
		expect(
			ratingWindow(night, DEFAULT_GROUP_SETTINGS, new Date(CLOSES.getTime() - 1000)).state
		).toBe('open');
		expect(ratingWindow(night, DEFAULT_GROUP_SETTINGS, CLOSES)).toEqual({
			state: 'closed',
			closedAt: CLOSES
		});
	});

	it('never opens for a night without a film', () => {
		for (const status of ['scheduled', 'cancelled']) {
			expect(ratingWindow({ status, scheduledAt: START }, DEFAULT_GROUP_SETTINGS, DURING)).toEqual({
				state: 'not_ratable'
			});
		}
	});
});

describe('saveRating', () => {
	it('saves, and lets the rater change it before the reveal', () => {
		expect(rate(grace, 7)).toEqual({ ok: true, revealed: false });
		expect(rate(grace, 8.5, 'better on reflection')).toEqual({ ok: true, revealed: false });
		expect(ratingView(db, nightId, grace, DURING, 'Former member')?.mine).toEqual({
			score: 8.5,
			comment: 'better on reflection'
		});
	});

	it('refuses outside the window, a bad score and an over-long comment', () => {
		expect(rate(grace, 7, null, new Date(OPENS.getTime() - 1000))).toEqual({
			ok: false,
			reason: 'window'
		});
		expect(rate(grace, 7, null, CLOSES)).toEqual({ ok: false, reason: 'window' });
		expect(
			saveRating(db, { nightId, userId: grace, scoreX2: 21, comment: null, now: DURING })
		).toEqual({ ok: false, reason: 'score' });
		expect(rate(grace, 7, 'x'.repeat(COMMENT_MAX + 1))).toEqual({ ok: false, reason: 'comment' });
		expect(db.select().from(ratings).all()).toHaveLength(0);
	});

	it('refuses somebody outside the group', () => {
		const mallory = person('mallory');
		expect(() => rate(mallory, 7)).toThrow();
	});

	it('marks a drawn night watched with the first rating', () => {
		rate(grace, 7);
		expect(
			db
				.select({ status: movieNights.status })
				.from(movieNights)
				.where(eq(movieNights.id, nightId))
				.get()?.status
		).toBe('watched');
	});

	it('makes the fairness window start counting the film, like markWatched does', () => {
		// Grace suggested the drawn film (beforeEach), so rating it is what should
		// mark it watched and start counting toward her fairness window — the same
		// property nights.test.ts proves for markWatched itself.
		rate(grace, 7);
		addSuggestion(db, {
			groupId,
			userId: grace,
			movie: { title: 'Arrival' },
			settings: DEFAULT_GROUP_SETTINGS
		});
		expect(candidatesFor(db, groupId).find((c) => c.userId === grace)?.watchedInWindow).toBe(1);
	});

	it('leaves exactly one row per member no matter how many times they save (R2)', () => {
		// Enforced in code now, not by a unique index (R2) — see schema.ts.
		rate(grace, 7);
		rate(grace, 8.5, 'better on reflection');
		rate(grace, 9);
		expect(db.select().from(ratings).where(eq(ratings.userId, grace)).all()).toHaveLength(1);
	});

	it('reveals when the last "I\'m in" member rates, and not before', () => {
		respond(db, nightId, grace, 'yes');
		respond(db, nightId, alan, 'yes');
		respond(db, nightId, ada, 'no');
		expect(rate(grace, 7)).toEqual({ ok: true, revealed: false });
		expect(rate(alan, 5)).toEqual({ ok: true, revealed: true });
	});

	it('never reveals on its own when nobody said "I\'m in"', () => {
		expect(rate(grace, 7).ok && rate(alan, 5)).toEqual({ ok: true, revealed: false });
	});

	it('does not un-reveal when somebody switches to "I\'m in" afterwards', () => {
		respond(db, nightId, grace, 'yes');
		rate(grace, 7);
		respond(db, nightId, alan, 'yes');
		expect(ratingView(db, nightId, alan, DURING, 'Former member')?.revealed).toBe(true);
	});

	it('sets revealed_at once and never overwrites it', () => {
		respond(db, nightId, grace, 'yes');
		rate(grace, 7, null, DURING);
		const first = db.select({ at: movieNights.revealedAt }).from(movieNights).get()?.at;
		rate(alan, 5, null, new Date(DURING.getTime() + HOUR));
		expect(db.select({ at: movieNights.revealedAt }).from(movieNights).get()?.at).toEqual(first);
	});

	it('locks a rating after the reveal but still takes a late one', () => {
		respond(db, nightId, grace, 'yes');
		rate(grace, 7);
		expect(rate(grace, 9)).toEqual({ ok: false, reason: 'locked' });
		expect(rate(alan, 4)).toEqual({ ok: true, revealed: true });
	});
});

describe('withdrawRating', () => {
	it('withdraws before the reveal and refuses after it', () => {
		rate(grace, 7);
		expect(withdrawRating(db, { nightId, userId: grace, now: DURING })).toBe('ok');
		expect(withdrawRating(db, { nightId, userId: grace, now: DURING })).toBe('not_found');
		respond(db, nightId, alan, 'yes');
		rate(alan, 5);
		expect(withdrawRating(db, { nightId, userId: alan, now: DURING })).toBe('locked');
	});
});

describe('revealNow', () => {
	it('lets the owner reveal once there is a rating, once', () => {
		expect(revealNow(db, { nightId, ownerId: ada, now: DURING })).toBe('no_ratings');
		rate(grace, 7);
		expect(revealNow(db, { nightId, ownerId: ada, now: DURING })).toBe('ok');
		expect(revealNow(db, { nightId, ownerId: ada, now: DURING })).toBe('already');
	});

	it('refuses a member who is not the owner, and before the night has ended', () => {
		rate(grace, 7);
		expect(() => revealNow(db, { nightId, ownerId: grace, now: DURING })).toThrow();
		expect(revealNow(db, { nightId, ownerId: ada, now: new Date(OPENS.getTime() - 1000) })).toBe(
			'window'
		);
	});

	it('treats a closed window as already revealed, and does not stamp it', () => {
		rate(grace, 7);
		expect(revealNow(db, { nightId, ownerId: ada, now: CLOSES })).toBe('already');
		expect(db.select({ at: movieNights.revealedAt }).from(movieNights).get()?.at).toBeNull();
	});
});

describe('ratingView', () => {
	it('shows nobody else’s score or comment before the reveal', () => {
		rate(grace, 7, 'grace-secret-comment');
		rate(alan, 3, 'alan-secret-comment');
		const view = ratingView(db, nightId, alan, DURING, 'Former member');
		const text = JSON.stringify(view);
		expect(text).not.toContain('grace-secret-comment');
		expect(view?.results).toBeNull();
		expect(view?.mine).toEqual({ score: 3, comment: 'alan-secret-comment' });
		expect(view?.rated.sort()).toEqual(['Alan', 'Grace']);
		expect(view?.count).toBe(2);
	});

	it('names who the reveal is waiting for', () => {
		respond(db, nightId, grace, 'yes');
		respond(db, nightId, alan, 'yes');
		rate(grace, 7);
		expect(ratingView(db, nightId, ada, DURING, 'Former member')?.waitingFor).toEqual(['Alan']);
	});

	it('gives the figures after the reveal', () => {
		rate(grace, 7);
		rate(alan, 3, 'not for me');
		rate(ada, 7);
		revealNow(db, { nightId, ownerId: ada, now: DURING });
		const results = ratingView(db, nightId, ada, DURING, 'Former member')?.results;
		expect(results?.average).toBeCloseTo(17 / 3);
		expect(results?.lowest).toEqual({ score: 3, names: ['Alan'] });
		expect(results?.highest).toEqual({ score: 7, names: ['Ada', 'Grace'] });
		expect(results?.tmdb?.rating).toBe(8);
		expect(results?.tmdb?.delta).toBeCloseTo(17 / 3 - 8);
		expect(results?.ratings).toContainEqual({ name: 'Alan', score: 3, comment: 'not for me' });
	});

	it('shows the results once the window has closed, even unrevealed', () => {
		rate(grace, 7);
		const view = ratingView(db, nightId, alan, CLOSES, 'Former member');
		expect(view?.revealed).toBe(true);
		expect(view?.results?.average).toBe(7);
	});

	it('keeps a departed member’s rating and stops waiting for them', () => {
		respond(db, nightId, grace, 'yes');
		respond(db, nightId, alan, 'yes');
		rate(grace, 6);
		leaveGroup(db, grace, groupId);
		expect(ratingView(db, nightId, ada, DURING, 'Former member')?.waitingFor).toEqual(['Alan']);
		// Alan is the only current "I'm in" member left, so his rating reveals.
		expect(rate(alan, 8)).toEqual({ ok: true, revealed: true });
		const results = ratingView(db, nightId, ada, DURING, 'Former member')?.results;
		expect(results?.ratings).toContainEqual({ name: 'Grace', score: 6, comment: null });
	});

	it('never lets a departed member who never rated block the reveal', () => {
		respond(db, nightId, grace, 'yes');
		respond(db, nightId, alan, 'yes');
		leaveGroup(db, grace, groupId);
		expect(rate(alan, 8)).toEqual({ ok: true, revealed: true });
		expect(ratingView(db, nightId, ada, DURING, 'Former member')?.waitingFor).toEqual([]);
	});

	it('returns nothing for somebody outside the group', () => {
		const mallory = person('mallory');
		expect(ratingView(db, nightId, mallory, DURING, 'Former member')).toBeNull();
	});
});

describe('averagesFor', () => {
	it('lists only revealed nights', () => {
		rate(grace, 7);
		expect(averagesFor(db, groupId, DEFAULT_GROUP_SETTINGS, DURING).size).toBe(0);
		revealNow(db, { nightId, ownerId: ada, now: DURING });
		expect(averagesFor(db, groupId, DEFAULT_GROUP_SETTINGS, DURING).get(nightId)).toBe(7);
	});
});

// Keep the `movies` import honest: the TMDB rating really is on the movie row.
it('stores the TMDB rating the figures compare against', () => {
	expect(db.select({ r: movies.tmdbRating }).from(movies).get()?.r).toBe(8);
});
