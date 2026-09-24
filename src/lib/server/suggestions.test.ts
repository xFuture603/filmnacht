import { beforeEach, describe, expect, it } from 'vitest';
import { applyMigrations, createDb, type DB } from './db/client';
import {
	DEFAULT_GROUP_SETTINGS,
	movieNights,
	movies,
	suggestions,
	type GroupSettings
} from './db/schema';
import { createGroup, addMember } from './groups';
import {
	addSuggestion,
	countOpenSuggestions,
	listPool,
	TITLE_MAX,
	withdrawSuggestion
} from './suggestions';
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

	it('accepts a title exactly at the length limit', () => {
		const title = 'x'.repeat(TITLE_MAX);
		expect(addSuggestion(db, { groupId, userId: ada, movie: { title }, settings }).ok).toBe(true);
	});

	it('rejects a title one character over the length limit, rather than truncating it', () => {
		const title = 'x'.repeat(TITLE_MAX + 1);
		expect(addSuggestion(db, { groupId, userId: ada, movie: { title }, settings })).toEqual({
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

	it('revives a withdrawn suggestion rather than colliding on the group+dedupeKey unique index', () => {
		const first = addSuggestion(db, { groupId, userId: ada, movie: dune, settings });
		withdrawSuggestion(db, ada, (first as { suggestionId: string }).suggestionId);
		const second = addSuggestion(db, { groupId, userId: ada, movie: dune, settings });
		expect(second.ok).toBe(true);
		expect(listPool(db, groupId, ada, settings).map((e) => e.title)).toEqual(['Dune']);
	});

	it('lets a different member claim a film the original suggester withdrew, attributing it to them', () => {
		const first = addSuggestion(db, { groupId, userId: ada, movie: dune, settings });
		withdrawSuggestion(db, ada, (first as { suggestionId: string }).suggestionId);
		const second = addSuggestion(db, { groupId, userId: grace, movie: dune, settings });
		expect(second.ok).toBe(true);
		expect(listPool(db, groupId, grace, settings).find((e) => e.title === 'Dune')?.mine).toBe(true);
		expect(listPool(db, groupId, ada, settings).find((e) => e.title === 'Dune')?.mine).toBe(false);
	});

	it("counts a revived suggestion against the reviver's cap, not the original suggester's", () => {
		const capped = { ...settings, maxOpenSuggestions: 1 };
		const first = addSuggestion(db, { groupId, userId: ada, movie: dune, settings: capped });
		withdrawSuggestion(db, ada, (first as { suggestionId: string }).suggestionId);
		addSuggestion(db, { groupId, userId: grace, movie: dune, settings: capped });
		expect(countOpenSuggestions(db, groupId, ada)).toBe(0);
		expect(countOpenSuggestions(db, groupId, grace)).toBe(1);
	});

	it('drops the old note when reviving rather than carrying it to the new suggester', () => {
		const first = addSuggestion(db, {
			groupId,
			userId: ada,
			movie: dune,
			note: "Ada's private reason",
			settings
		});
		withdrawSuggestion(db, ada, (first as { suggestionId: string }).suggestionId);
		addSuggestion(db, {
			groupId,
			userId: grace,
			movie: dune,
			note: "Grace's own reason",
			settings
		});
		const row = db.select().from(suggestions).get();
		expect(row?.note).toBe("Grace's own reason");
		expect(row?.note).not.toBe("Ada's private reason");
	});

	it('refuses to revive a withdrawn suggestion a movie_nights row already references', () => {
		const first = addSuggestion(db, { groupId, userId: ada, movie: dune, settings });
		const id = (first as { suggestionId: string }).suggestionId;
		withdrawSuggestion(db, ada, id);
		db.insert(movieNights).values({ groupId, scheduledAt: new Date(), suggestionId: id }).run();
		const second = addSuggestion(db, { groupId, userId: grace, movie: dune, settings });
		expect(second).toEqual({ ok: false, reason: 'duplicate' });
	});

	it('does not leak a movies row on a withdraw/re-add cycle of a hand-typed film', () => {
		const handTyped = { title: 'A Hand-Typed Film', year: 2020 };
		const before = db.select({ id: movies.id }).from(movies).all().length;
		// Three withdraw/re-add cycles of the same hand-typed film.
		for (let i = 0; i < 3; i++) {
			const added = addSuggestion(db, { groupId, userId: ada, movie: handTyped, settings });
			withdrawSuggestion(db, ada, (added as { suggestionId: string }).suggestionId);
		}
		addSuggestion(db, { groupId, userId: ada, movie: handTyped, settings });
		const after = db.select({ id: movies.id }).from(movies).all().length;
		// One row for the film's first insert, none added by any of the later
		// withdraw/re-add cycles.
		expect(after - before).toBe(1);
	});

	it('still refuses a duplicate that is open, without reviving anything', () => {
		addSuggestion(db, { groupId, userId: ada, movie: dune, settings });
		const result = addSuggestion(db, { groupId, userId: grace, movie: dune, settings });
		expect(result).toEqual({ ok: false, reason: 'duplicate' });
	});

	it('still refuses a duplicate that has already been drawn, without reviving it', () => {
		const first = addSuggestion(db, { groupId, userId: ada, movie: dune, settings });
		const id = (first as { suggestionId: string }).suggestionId;
		db.update(suggestions).set({ status: 'drawn' }).where(eq(suggestions.id, id)).run();
		const result = addSuggestion(db, { groupId, userId: grace, movie: dune, settings });
		expect(result).toEqual({ ok: false, reason: 'duplicate' });
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

	it('orders the pool by title, not by when a film was added', () => {
		// Insertion order is Zebra then Apple — the reverse of title order — so a
		// result matching title order cannot be an accident of row order.
		addSuggestion(db, { groupId, userId: ada, movie: { title: 'Zebra' }, settings });
		addSuggestion(db, { groupId, userId: grace, movie: { title: 'Apple' }, settings });
		expect(listPool(db, groupId, ada, settings).map((e) => e.title)).toEqual(['Apple', 'Zebra']);
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

	it("does not count a member's open suggestions in a different group", () => {
		const other = createGroup(db, { name: 'Other', ownerId: ada });
		addSuggestion(db, { groupId, userId: ada, movie: dune, settings });
		expect(countOpenSuggestions(db, groupId, ada)).toBe(1);
		addSuggestion(db, { groupId: other, userId: ada, movie: arrival, settings });
		expect(countOpenSuggestions(db, groupId, ada)).toBe(1);
	});
});
