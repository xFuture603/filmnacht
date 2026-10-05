import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { applyMigrations, createDb, type DB } from './db/client';
import { DEFAULT_GROUP_SETTINGS, memberships, suggestions } from './db/schema';
import { addMember, createGroup, leaveGroup } from './groups';
import { cancelNight, drawForNight, scheduleNight } from './nights';
import { addSuggestion, withdrawSuggestion } from './suggestions';
import { createUser } from './users';
import { newCounts, visit } from './seen';

let db: DB;
let ada: string; // owner
let grace: string; // member
let groupId: string;

const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000);

function suggest(userId: string, title: string): string {
	const result = addSuggestion(db, {
		groupId,
		userId,
		movie: { title },
		settings: DEFAULT_GROUP_SETTINGS
	});
	if (!result.ok) throw new Error(result.reason);
	return result.suggestionId;
}

function night(): string {
	return scheduleNight(db, {
		groupId,
		userId: ada,
		scheduledAt: new Date(Date.now() + 86_400_000),
		location: null
	});
}

beforeEach(() => {
	db = createDb(':memory:').db;
	applyMigrations(db);
	ada = createUser(db, { username: 'ada', displayName: 'Ada', passwordHash: 'x' }).id;
	grace = createUser(db, { username: 'grace', displayName: 'Grace', passwordHash: 'x' }).id;
	groupId = createGroup(db, { name: 'Filmnacht', ownerId: ada });
	addMember(db, grace, groupId);
	// created_at has one-second precision: put the joins well before anything
	// the tests add, so "created after joining" is unambiguous.
	db.update(memberships)
		.set({ joinedAt: minutesAgo(60) })
		.run();
});

describe('newCounts', () => {
	it("counts other members' films, never your own", () => {
		suggest(grace, 'Dune');
		suggest(ada, 'Arrival');
		expect(newCounts(db, ada, groupId).pool).toBe(1);
		expect(newCounts(db, grace, groupId).pool).toBe(1);
	});

	it('starts a new member at 0', () => {
		suggest(grace, 'Dune');
		night();
		const lin = createUser(db, { username: 'lin', displayName: 'Lin', passwordHash: 'x' }).id;
		addMember(db, lin, groupId);
		expect(newCounts(db, lin, groupId)).toEqual({ pool: 0, nights: 0 });
	});

	it('counts new nights for members, never for the owner', () => {
		night();
		expect(newCounts(db, grace, groupId).nights).toBe(1);
		expect(newCounts(db, ada, groupId).nights).toBe(0);
	});

	it('leaves out withdrawn and drawn films and cancelled nights', () => {
		const dune = suggest(grace, 'Dune');
		withdrawSuggestion(db, grace, dune);
		suggest(grace, 'Arrival');
		const drawn = night();
		drawForNight(db, drawn, ada); // Arrival is the only open film, so it is drawn
		cancelNight(db, night(), ada);
		expect(newCounts(db, ada, groupId).pool).toBe(0);
		expect(newCounts(db, grace, groupId).nights).toBe(1); // the drawn night, not the cancelled one
	});

	it('counts a film with no suggester (a wildcard) for everyone', () => {
		const id = suggest(grace, 'Dune');
		db.update(suggestions).set({ suggestedBy: null }).where(eq(suggestions.id, id)).run();
		expect(newCounts(db, ada, groupId).pool).toBe(1);
		expect(newCounts(db, grace, groupId).pool).toBe(1);
	});

	it('counts a withdrawn film that is suggested again as new', () => {
		const id = suggest(grace, 'Dune');
		db.update(suggestions)
			.set({ createdAt: minutesAgo(120) })
			.where(eq(suggestions.id, id))
			.run();
		visit(db, ada, groupId, 'pool', minutesAgo(30));
		expect(newCounts(db, ada, groupId).pool).toBe(0);
		withdrawSuggestion(db, grace, id);
		suggest(grace, 'Dune'); // revives the row and resets created_at
		expect(newCounts(db, ada, groupId).pool).toBe(1);
	});

	it('keeps the last visit as the baseline when a member leaves and is re-added', () => {
		// Added between grace joining (60 min ago) and her last visit (30 min ago):
		// seen already, so it must not come back as new after re-joining.
		const dune = suggest(ada, 'Dune');
		db.update(suggestions)
			.set({ createdAt: minutesAgo(45) })
			.where(eq(suggestions.id, dune))
			.run();
		visit(db, grace, groupId, 'pool', minutesAgo(30));
		leaveGroup(db, grace, groupId);
		suggest(ada, 'Arrival');
		addMember(db, grace, groupId);
		expect(newCounts(db, grace, groupId).pool).toBe(1); // Arrival only
	});

	it('refuses someone who is not a member', () => {
		const lin = createUser(db, { username: 'lin', displayName: 'Lin', passwordHash: 'x' }).id;
		expect(() => newCounts(db, lin, groupId)).toThrow('not a member');
	});
});

describe('visit', () => {
	it('clears the visited tab and leaves the other one alone', () => {
		suggest(ada, 'Dune');
		night();
		expect(newCounts(db, grace, groupId)).toEqual({ pool: 1, nights: 1 });
		expect(visit(db, grace, groupId, 'pool').counts).toEqual({ pool: 0, nights: 1 });
		expect(newCounts(db, grace, groupId)).toEqual({ pool: 0, nights: 1 });
	});

	it('marks against the old baseline, so a second visit finds nothing new', () => {
		const dune = suggest(grace, 'Dune');
		expect(visit(db, ada, groupId, 'pool').newIds).toEqual(new Set([dune]));
		expect(visit(db, ada, groupId, 'pool').newIds).toEqual(new Set());
	});

	it('counts a film added after the visit again', () => {
		visit(db, ada, groupId, 'pool', minutesAgo(30));
		suggest(grace, 'Dune');
		expect(newCounts(db, ada, groupId).pool).toBe(1);
	});

	it('marks new nights for a member, none for the owner', () => {
		const id = night();
		expect(visit(db, grace, groupId, 'nights').newIds).toEqual(new Set([id]));
		expect(visit(db, ada, groupId, 'nights').newIds).toEqual(new Set());
	});
});
