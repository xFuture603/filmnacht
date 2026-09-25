import { beforeEach, describe, expect, it } from 'vitest';
import { applyMigrations, createDb, type DB } from '$lib/server/db/client';
import { addMember, createGroup } from '$lib/server/groups';
import { createUser } from '$lib/server/users';
import { LOCATION_MAX, listNights, nightDetail, respond, scheduleNight } from './nights';

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
