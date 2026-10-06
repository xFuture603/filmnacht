import { beforeEach, describe, expect, it } from 'vitest';
import { applyMigrations, createDb, type DB } from './db/client';
import { DEFAULT_GROUP_SETTINGS, type GroupSettings } from './db/schema';
import { addMember, createGroup } from './groups';
import { cancelNight, drawForNight, nextNight, respond, scheduleNight } from './nights';
import { addSuggestion } from './suggestions';
import { createUser } from './users';

let db: DB;
let ada: string; // owner
let grace: string;
let groupId: string;

const HOUR = 3_600_000;
const now = new Date('2030-07-01T12:00:00Z');
const at = (hoursFromNow: number) => new Date(now.getTime() + hoursFromNow * HOUR);
const immediately: GroupSettings = { ...DEFAULT_GROUP_SETTINGS, resultVisible: 'immediately' };
const onNight: GroupSettings = { ...DEFAULT_GROUP_SETTINGS, resultVisible: 'on_night' };

function night(hoursFromNow: number): string {
	return scheduleNight(db, {
		groupId,
		userId: ada,
		scheduledAt: at(hoursFromNow),
		location: 'Sofa'
	});
}

beforeEach(() => {
	db = createDb(':memory:').db;
	applyMigrations(db);
	ada = createUser(db, { username: 'ada', displayName: 'Ada', passwordHash: 'x' }).id;
	grace = createUser(db, { username: 'grace', displayName: 'Grace', passwordHash: 'x' }).id;
	groupId = createGroup(db, { name: 'Filmnacht', ownerId: ada });
	addMember(db, grace, groupId);
	addSuggestion(db, {
		groupId,
		userId: grace,
		movie: { title: 'Dune', year: 2021, posterUrl: 'https://image.example/dune.jpg' },
		settings: DEFAULT_GROUP_SETTINGS
	});
});

describe('nextNight', () => {
	it('is null when nothing is coming up', () => {
		expect(nextNight(db, groupId, grace, immediately, now)).toBeNull();
	});

	it('picks the soonest night that has not ended', () => {
		night(48);
		const soon = night(24);
		expect(nextNight(db, groupId, grace, immediately, now)?.id).toBe(soon);
	});

	it('keeps a night that is under way, and drops one that is over', () => {
		// The default night lasts 180 minutes.
		const underWay = night(-2);
		night(-4);
		expect(nextNight(db, groupId, grace, immediately, now)?.id).toBe(underWay);
	});

	it('skips a cancelled night', () => {
		cancelNight(db, night(24), ada);
		const later = night(48);
		expect(nextNight(db, groupId, grace, immediately, now)?.id).toBe(later);
	});

	it('has no film before the draw', () => {
		night(24);
		expect(nextNight(db, groupId, grace, immediately, now)).toMatchObject({
			status: 'scheduled',
			film: null,
			filmHidden: false
		});
	});

	it('shows the drawn film with its poster', () => {
		drawForNight(db, night(24), ada);
		expect(nextNight(db, groupId, grace, immediately, now)).toMatchObject({
			status: 'drawn',
			film: { title: 'Dune', year: 2021, posterUrl: 'https://image.example/dune.jpg' },
			filmHidden: false
		});
	});

	it('keeps a surprise draw hidden until the night starts', () => {
		drawForNight(db, night(24), ada);
		expect(nextNight(db, groupId, grace, onNight, now)).toMatchObject({
			film: null,
			filmHidden: true
		});
		expect(nextNight(db, groupId, grace, onNight, at(25))?.film?.title).toBe('Dune');
	});

	it("carries the viewer's own answer", () => {
		const id = night(24);
		respond(db, id, grace, 'maybe');
		expect(nextNight(db, groupId, grace, immediately, now)?.myResponse).toBe('maybe');
		expect(nextNight(db, groupId, ada, immediately, now)?.myResponse).toBeNull();
	});
});
