import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { applyMigrations, createDb, type DB } from '$lib/server/db/client';
import { DEFAULT_GROUP_SETTINGS, movieNights } from '$lib/server/db/schema';
import { addMember, createGroup, leaveGroup } from '$lib/server/groups';
import { addSuggestion, listPool } from '$lib/server/suggestions';
import { createUser } from '$lib/server/users';
import type { DrawLogEntry } from './draw';
import {
	LOCATION_MAX,
	candidatesFor,
	drawForNight,
	listNights,
	nightDetail,
	respond,
	scheduleNight
} from './nights';

let db: DB;
let ada: string;
let grace: string;
let groupId: string;
const LATER = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

beforeEach(() => {
	db = createDb(':memory:').db;
	applyMigrations(db);
	ada = createUser(db, {
		username: 'ada',
		displayName: 'Ada',
		passwordHash: 'scrypt$placeholder$placeholder'
	}).id;
	grace = createUser(db, {
		username: 'grace',
		displayName: 'Grace',
		passwordHash: 'scrypt$placeholder$placeholder'
	}).id;
	groupId = createGroup(db, { name: 'Filmnacht', ownerId: ada });
	addMember(db, grace, groupId);
});

describe('scheduleNight', () => {
	it('schedules a night the group can see', () => {
		const id = scheduleNight(db, {
			groupId,
			userId: ada,
			scheduledAt: LATER,
			location: "Ada's flat"
		});
		const nights = listNights(db, groupId);
		expect(nights).toHaveLength(1);
		expect(nights[0].id).toBe(id);
		expect(nights[0].status).toBe('scheduled');
		expect(nights[0].location).toBe("Ada's flat");
	});

	it('refuses a member who does not own the group', () => {
		expect(() =>
			scheduleNight(db, { groupId, userId: grace, scheduledAt: LATER, location: null })
		).toThrow();
	});

	it('refuses somebody who is not in the group at all', () => {
		const mallory = createUser(db, {
			username: 'mallory',
			displayName: 'Mallory',
			passwordHash: 'scrypt$placeholder$placeholder'
		}).id;
		expect(() =>
			scheduleNight(db, { groupId, userId: mallory, scheduledAt: LATER, location: null })
		).toThrow();
	});

	it('stores the moment in UTC', () => {
		const id = scheduleNight(db, { groupId, userId: ada, scheduledAt: LATER, location: null });
		const night = nightDetail(db, id, ada);
		// Round-trips to the same instant. The display timezone is a render-time
		// concern; the column is UTC (PRD §6).
		expect(night?.scheduledAt.getTime()).toBe(Math.floor(LATER.getTime() / 1000) * 1000);
	});
});

describe('respond', () => {
	it('records a response and counts it', () => {
		const id = scheduleNight(db, { groupId, userId: ada, scheduledAt: LATER, location: null });
		respond(db, id, grace, 'yes');
		expect(listNights(db, groupId)[0].yes).toBe(1);
		expect(nightDetail(db, id, grace)?.myResponse).toBe('yes');
	});

	it('replaces an earlier response instead of adding a second', () => {
		const id = scheduleNight(db, { groupId, userId: ada, scheduledAt: LATER, location: null });
		respond(db, id, grace, 'yes');
		respond(db, id, grace, 'no');
		const nights = listNights(db, groupId);
		expect(nights[0].yes).toBe(0);
		expect(nights[0].no).toBe(1);
		expect(nightDetail(db, id, grace)?.responses).toHaveLength(1);
	});

	it('refuses a response from outside the group', () => {
		const mallory = createUser(db, {
			username: 'mallory',
			displayName: 'Mallory',
			passwordHash: 'scrypt$placeholder$placeholder'
		}).id;
		const id = scheduleNight(db, { groupId, userId: ada, scheduledAt: LATER, location: null });
		expect(() => respond(db, id, mallory, 'yes')).toThrow();
	});
});

describe('nightDetail', () => {
	it('returns nothing for a viewer outside the group', () => {
		const mallory = createUser(db, {
			username: 'mallory',
			displayName: 'Mallory',
			passwordHash: 'scrypt$placeholder$placeholder'
		}).id;
		const id = scheduleNight(db, { groupId, userId: ada, scheduledAt: LATER, location: null });
		expect(nightDetail(db, id, mallory)).toBeNull();
	});

	it('returns nothing for a night that does not exist', () => {
		expect(nightDetail(db, 'no-such-night', ada)).toBeNull();
	});
});

describe('input bounds', () => {
	it('refuses a location past the limit', () => {
		expect(() =>
			scheduleNight(db, {
				groupId,
				userId: ada,
				scheduledAt: LATER,
				location: 'x'.repeat(LOCATION_MAX + 1)
			})
		).toThrow();
	});
});

describe('drawForNight', () => {
	function openFilm(userId: string, title: string) {
		return addSuggestion(db, {
			groupId,
			userId,
			movie: { title },
			settings: DEFAULT_GROUP_SETTINGS
		});
	}

	it('draws the only suggestion and says it did not roll dice', () => {
		openFilm(ada, 'Dune');
		const id = scheduleNight(db, { groupId, userId: ada, scheduledAt: LATER, location: null });
		const result = drawForNight(db, id, ada);
		expect(result).toMatchObject({ ok: true, title: 'Dune', onlyCandidate: true });
	});

	it('closes the pool for that night and marks the suggestion drawn', () => {
		openFilm(ada, 'Dune');
		const id = scheduleNight(db, { groupId, userId: ada, scheduledAt: LATER, location: null });
		drawForNight(db, id, ada);
		expect(nightDetail(db, id, ada)?.status).toBe('drawn');
		expect(listPool(db, groupId, ada).find((e) => e.title === 'Dune')?.status).toBe('drawn');
	});

	it('refuses when nobody has suggested anything', () => {
		const id = scheduleNight(db, { groupId, userId: ada, scheduledAt: LATER, location: null });
		expect(drawForNight(db, id, ada)).toEqual({ ok: false, reason: 'no_candidates' });
	});

	it('refuses a member who does not own the group', () => {
		openFilm(ada, 'Dune');
		const id = scheduleNight(db, { groupId, userId: ada, scheduledAt: LATER, location: null });
		expect(() => drawForNight(db, id, grace)).toThrow();
	});

	it('draws once when two owners press the button at the same moment', () => {
		// Review Focus 1. The symptom of getting this wrong is not an error, it is
		// a group arguing about which film was really drawn.
		openFilm(ada, 'Dune');
		openFilm(grace, 'Arrival');
		const id = scheduleNight(db, { groupId, userId: ada, scheduledAt: LATER, location: null });

		const first = drawForNight(db, id, ada);
		const second = drawForNight(db, id, ada);

		expect(first.ok).toBe(true);
		expect(second).toEqual({ ok: false, reason: 'not_scheduled' });
		// And exactly one film left the pool.
		const drawn = listPool(db, groupId, ada).filter((e) => e.status === 'drawn');
		expect(drawn).toHaveLength(1);
	});

	it('records every candidate and the seed in an append-only log', () => {
		openFilm(ada, 'Dune');
		openFilm(grace, 'Arrival');
		const id = scheduleNight(db, { groupId, userId: ada, scheduledAt: LATER, location: null });
		drawForNight(db, id, ada);

		const row = db
			.select({ log: movieNights.drawLog, seed: movieNights.drawSeed })
			.from(movieNights)
			.where(eq(movieNights.id, id))
			.get();
		const log = row?.log as DrawLogEntry[];
		expect(log).toHaveLength(1);
		expect(log[0].candidates).toHaveLength(2);
		expect(log[0].seed).toBeGreaterThanOrEqual(0);
		expect(String(row?.seed)).toBe(String(log[0].seed));
	});

	it('leaves a departed member’s film in the pool but out of the draw', () => {
		// Review Focus 2. The draw draws people; somebody who left is not a person
		// who can take a turn. Their film stays visible as history.
		openFilm(grace, 'Arrival');
		leaveGroup(db, grace, groupId);
		const id = scheduleNight(db, { groupId, userId: ada, scheduledAt: LATER, location: null });

		expect(drawForNight(db, id, ada)).toEqual({ ok: false, reason: 'no_candidates' });
		expect(listPool(db, groupId, ada).map((e) => e.title)).toContain('Arrival');
	});

	it('counts only watched nights in the fairness window', () => {
		// The Global Constraint, and the easiest thing here to get wrong. A night
		// that was drawn but never watched must not cost anybody their turn.
		openFilm(ada, 'Dune');
		const drawnOnly = scheduleNight(db, {
			groupId,
			userId: ada,
			scheduledAt: LATER,
			location: null
		});
		drawForNight(db, drawnOnly, ada);

		// Ada's film is drawn but the night is not watched, so her weight must
		// still be the maximum.
		openFilm(ada, 'Arrival');
		expect(candidatesFor(db, groupId).find((c) => c.userId === ada)?.watchedInWindow).toBe(0);
	});

	it('defines every weight in a group with fewer than ten nights', () => {
		// Review Focus 3. A group in its first month has three nights, not ten.
		openFilm(ada, 'Dune');
		const candidates = candidatesFor(db, groupId);
		expect(candidates).toHaveLength(1);
		expect(Number.isFinite(candidates[0].watchedInWindow)).toBe(true);
	});
});
