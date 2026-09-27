import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { applyMigrations, createDb, type DB } from '$lib/server/db/client';
import { DEFAULT_GROUP_SETTINGS, groups, movieNights } from '$lib/server/db/schema';
import { addMember, createGroup } from '$lib/server/groups';
import { setSetting } from '$lib/server/settings';
import { addSuggestion } from '$lib/server/suggestions';
import { createUser } from '$lib/server/users';
import type { DrawLogEntry } from './draw';
import { cancelNight, drawForNight, nightDetail, scheduleNight } from './nights';
import { dueForAutoDraw, runDueDraws } from './scheduler';

const HOUR = 60 * 60 * 1000;
const START = new Date('2030-03-01T19:00:00Z');
const DUE = new Date(START.getTime() - 24 * HOUR);

let db: DB;
let ada: string;
let grace: string;
let groupId: string;
let nightId: string;

function film(userId: string, title: string) {
	addSuggestion(db, { groupId, userId, movie: { title }, settings: DEFAULT_GROUP_SETTINGS });
}

function logOf(id: string): DrawLogEntry[] {
	return (db
		.select({ log: movieNights.drawLog })
		.from(movieNights)
		.where(eq(movieNights.id, id))
		.get()?.log ?? []) as DrawLogEntry[];
}

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
	setSetting(db, 'timezone', 'Europe/Berlin');
	db.update(groups)
		.set({ settings: { ...DEFAULT_GROUP_SETTINGS, autoDraw: true, autoDrawHoursBefore: 24 } })
		.where(eq(groups.id, groupId))
		.run();
	nightId = scheduleNight(db, { groupId, userId: ada, scheduledAt: START, location: null });
});

describe('dueForAutoDraw / runDueDraws', () => {
	it('does not draw a minute before the due time', () => {
		film(grace, 'Dune');
		film(grace, 'Arrival');
		const now = new Date(DUE.getTime() - 60_000);

		expect(runDueDraws(db, now)).toBe(0);
		expect(nightDetail(db, nightId, ada)?.status).toBe('scheduled');
	});

	it('draws at the due time, logs by: null, and calls onDrawn', () => {
		film(grace, 'Dune');
		film(grace, 'Arrival');
		const drawn: string[] = [];

		expect(runDueDraws(db, DUE, (id) => drawn.push(id))).toBe(1);

		expect(nightDetail(db, nightId, ada)?.status).toBe('drawn');
		const log = logOf(nightId);
		expect(log).toHaveLength(1);
		expect(log[0].by).toBeNull();
		expect(drawn).toEqual([nightId]);
	});

	it('never draws a group with automatic draw off', () => {
		film(grace, 'Dune');
		db.update(groups)
			.set({ settings: { ...DEFAULT_GROUP_SETTINGS, autoDraw: false, autoDrawHoursBefore: 24 } })
			.where(eq(groups.id, groupId))
			.run();

		expect(runDueDraws(db, DUE)).toBe(0);
		expect(nightDetail(db, nightId, ada)?.status).toBe('scheduled');
	});

	it('catches up after downtime, but never after the night has started', () => {
		film(grace, 'Dune');

		// Restarted a minute before the night starts: still draws.
		expect(runDueDraws(db, new Date(START.getTime() - 60_000))).toBe(1);
		expect(nightDetail(db, nightId, ada)?.status).toBe('drawn');
	});

	it('never draws once the night has started', () => {
		film(grace, 'Dune');

		expect(runDueDraws(db, START)).toBe(0);
		expect(nightDetail(db, nightId, ada)?.status).toBe('scheduled');
		expect(runDueDraws(db, new Date(START.getTime() + 60_000))).toBe(0);
		expect(nightDetail(db, nightId, ada)?.status).toBe('scheduled');
	});

	it('leaves an undrawable night scheduled, then draws it once a film exists', () => {
		expect(dueForAutoDraw(db, DUE)).toEqual([nightId]);
		expect(runDueDraws(db, DUE)).toBe(0);
		expect(nightDetail(db, nightId, ada)?.status).toBe('scheduled');

		film(grace, 'Dune');
		expect(runDueDraws(db, DUE)).toBe(1);
		expect(nightDetail(db, nightId, ada)?.status).toBe('drawn');
	});

	it('draws once when a manual draw races the scheduler', () => {
		film(grace, 'Dune');
		film(grace, 'Arrival');
		const manual = drawForNight(db, nightId, ada);
		expect(manual.ok).toBe(true);
		const drawn: string[] = [];

		expect(runDueDraws(db, DUE, (id) => drawn.push(id))).toBe(0);

		expect(logOf(nightId)).toHaveLength(1);
		expect(drawn).toEqual([]);
	});

	it('never draws a cancelled night', () => {
		film(grace, 'Dune');
		expect(cancelNight(db, nightId, ada)).toBe(true);

		expect(runDueDraws(db, DUE)).toBe(0);
		expect(nightDetail(db, nightId, ada)?.status).toBe('cancelled');
	});

	it('keeps drawing due nights after onDrawn throws for an earlier one (R2)', () => {
		film(grace, 'Dune');
		film(grace, 'Arrival');
		const nightId2 = scheduleNight(db, {
			groupId,
			userId: ada,
			scheduledAt: START,
			location: null
		});

		const notified: string[] = [];
		const onDrawn = (id: string) => {
			if (id === nightId) throw new Error('draw notification failed');
			notified.push(id);
		};

		expect(runDueDraws(db, DUE, onDrawn)).toBe(2);
		expect(nightDetail(db, nightId, ada)?.status).toBe('drawn');
		expect(nightDetail(db, nightId2, ada)?.status).toBe('drawn');
		expect(notified).toEqual([nightId2]);
	});
});

describe('nightDetail(...).drawnAutomatically', () => {
	it('is true after a scheduler draw and false after a manual one', () => {
		film(grace, 'Dune');
		runDueDraws(db, DUE);
		expect(nightDetail(db, nightId, ada)?.drawnAutomatically).toBe(true);

		const manualNight = scheduleNight(db, {
			groupId,
			userId: ada,
			scheduledAt: START,
			location: null
		});
		film(grace, 'Arrival');
		drawForNight(db, manualNight, ada);
		expect(nightDetail(db, manualNight, ada)?.drawnAutomatically).toBe(false);
	});
});
