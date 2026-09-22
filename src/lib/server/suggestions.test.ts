import { beforeEach, describe, expect, it } from 'vitest';
import { applyMigrations, createDb, type DB } from './db/client';
import { DEFAULT_GROUP_SETTINGS, suggestions, type GroupSettings } from './db/schema';
import { createGroup, addMember } from './groups';
import { addSuggestion, countOpenSuggestions, listPool, withdrawSuggestion } from './suggestions';
import { createUser } from './users';
import { eq } from 'drizzle-orm';

let db: DB;
let ada: string;
let grace: string;
let groupId: string;
const settings: GroupSettings = DEFAULT_GROUP_SETTINGS;

const dune = { tmdbId: 438631, title: 'Dune', year: 2021, posterUrl: '/p.jpg', runtime: 155 };
const arrival = { tmdbId: 329865, title: 'Arrival', year: 2016 };

beforeEach(() => {
	db = createDb(':memory:').db;
	applyMigrations(db);
	ada = createUser(db, 'Ada').id;
	grace = createUser(db, 'Grace').id;
	groupId = createGroup(db, { name: 'Movie Club', ownerId: ada });
	addMember(db, grace, groupId);
});

describe('addSuggestion', () => {
	it('adds a film to the pool', () => {
		const result = addSuggestion(db, { groupId, userId: ada, movie: dune, settings });
		expect(result.ok).toBe(true);
		expect(listPool(db, groupId, ada, settings)).toHaveLength(1);
	});

	it('refuses a duplicate without saying who added it first', () => {
		addSuggestion(db, { groupId, userId: ada, movie: dune, settings });
		const result = addSuggestion(db, { groupId, userId: grace, movie: dune, settings });
		expect(result).toEqual({ ok: false, reason: 'duplicate' });
		expect(JSON.stringify(result)).not.toContain(ada);
	});

	it('treats the same film typed by hand as a duplicate of itself', () => {
		addSuggestion(db, { groupId, userId: ada, movie: { title: 'Amélie', year: 2001 }, settings });
		const result = addSuggestion(db, {
			groupId,
			userId: grace,
			movie: { title: 'amelie', year: 2001 },
			settings
		});
		expect(result).toEqual({ ok: false, reason: 'duplicate' });
	});

	it('lets a different group hold the same film', () => {
		const other = createGroup(db, { name: 'Other', ownerId: grace });
		addSuggestion(db, { groupId, userId: ada, movie: dune, settings });
		expect(addSuggestion(db, { groupId: other, userId: grace, movie: dune, settings }).ok).toBe(
			true
		);
	});

	it('refuses once the member is at their cap', () => {
		const capped = { ...settings, maxOpenSuggestions: 1 };
		addSuggestion(db, { groupId, userId: ada, movie: dune, settings: capped });
		expect(addSuggestion(db, { groupId, userId: ada, movie: arrival, settings: capped })).toEqual({
			ok: false,
			reason: 'cap_reached'
		});
	});

	it('counts the cap per member, not per group', () => {
		const capped = { ...settings, maxOpenSuggestions: 1 };
		addSuggestion(db, { groupId, userId: ada, movie: dune, settings: capped });
		expect(addSuggestion(db, { groupId, userId: grace, movie: arrival, settings: capped }).ok).toBe(
			true
		);
	});

	it('frees a slot when a suggestion is withdrawn', () => {
		const capped = { ...settings, maxOpenSuggestions: 1 };
		const first = addSuggestion(db, { groupId, userId: ada, movie: dune, settings: capped });
		withdrawSuggestion(db, ada, (first as { suggestionId: string }).suggestionId);
		expect(addSuggestion(db, { groupId, userId: ada, movie: arrival, settings: capped }).ok).toBe(
			true
		);
	});

	it('rejects an empty title rather than storing a blank film', () => {
		expect(addSuggestion(db, { groupId, userId: ada, movie: { title: '  ' }, settings })).toEqual({
			ok: false,
			reason: 'bad_title'
		});
	});

	it('truncates an over-long note rather than refusing the film', () => {
		const note = 'x'.repeat(500);
		const result = addSuggestion(db, { groupId, userId: ada, movie: dune, note, settings });
		const row = db.select().from(suggestions).get();
		expect(result.ok).toBe(true);
		expect(row?.note).toHaveLength(200);
	});
});

describe('withdrawSuggestion', () => {
	it('withdraws your own open suggestion', () => {
		const added = addSuggestion(db, { groupId, userId: ada, movie: dune, settings });
		const id = (added as { suggestionId: string }).suggestionId;
		expect(withdrawSuggestion(db, ada, id)).toBe('ok');
		expect(listPool(db, groupId, ada, settings)).toHaveLength(0);
	});

	it("refuses to withdraw someone else's suggestion", () => {
		const added = addSuggestion(db, { groupId, userId: ada, movie: dune, settings });
		const id = (added as { suggestionId: string }).suggestionId;
		expect(withdrawSuggestion(db, grace, id)).toBe('not_found');
		expect(listPool(db, groupId, ada, settings)).toHaveLength(1);
	});

	it('refuses to withdraw a film that has already been drawn', () => {
		const added = addSuggestion(db, { groupId, userId: ada, movie: dune, settings });
		const id = (added as { suggestionId: string }).suggestionId;
		db.update(suggestions).set({ status: 'drawn' }).where(eq(suggestions.id, id)).run();
		expect(withdrawSuggestion(db, ada, id)).toBe('already_drawn');
	});
});

describe('listPool', () => {
	it('marks only your own suggestions as yours', () => {
		addSuggestion(db, { groupId, userId: ada, movie: dune, settings });
		addSuggestion(db, { groupId, userId: grace, movie: arrival, settings });
		const asAda = listPool(db, groupId, ada, settings);
		expect(asAda.filter((entry) => entry.mine).map((entry) => entry.title)).toEqual(['Dune']);
	});

	it("never carries another member's identity in the payload", () => {
		addSuggestion(db, { groupId, userId: grace, movie: arrival, settings });
		const asAda = listPool(db, groupId, ada, settings);
		expect(JSON.stringify(asAda)).not.toContain(grace);
		expect(Object.keys(asAda[0])).not.toContain('suggestedBy');
	});

	it('hides withdrawn suggestions from everyone', () => {
		const added = addSuggestion(db, { groupId, userId: ada, movie: dune, settings });
		withdrawSuggestion(db, ada, (added as { suggestionId: string }).suggestionId);
		expect(listPool(db, groupId, grace, settings)).toHaveLength(0);
	});

	it('drops a drawn film from the pool by default', () => {
		const added = addSuggestion(db, { groupId, userId: ada, movie: dune, settings });
		const id = (added as { suggestionId: string }).suggestionId;
		db.update(suggestions).set({ status: 'drawn' }).where(eq(suggestions.id, id)).run();
		expect(listPool(db, groupId, ada, settings)).toHaveLength(0);
	});

	it('keeps a drawn film in the pool when the group allows repeats', () => {
		const repeats = { ...settings, repeatDrawnFilms: true };
		const added = addSuggestion(db, { groupId, userId: ada, movie: dune, settings: repeats });
		const id = (added as { suggestionId: string }).suggestionId;
		db.update(suggestions).set({ status: 'drawn' }).where(eq(suggestions.id, id)).run();
		expect(listPool(db, groupId, ada, repeats)).toHaveLength(1);
	});
});

describe('countOpenSuggestions', () => {
	it("counts only this member's open suggestions in this group", () => {
		addSuggestion(db, { groupId, userId: ada, movie: dune, settings });
		addSuggestion(db, { groupId, userId: grace, movie: arrival, settings });
		expect(countOpenSuggestions(db, groupId, ada)).toBe(1);
	});
});
