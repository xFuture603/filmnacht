import type { SQLiteTable } from 'drizzle-orm/sqlite-core';
import { beforeEach, describe, expect, it } from 'vitest';
import { applyMigrations, createDb, type DB } from './db/client';
import {
	attendance,
	DEFAULT_GROUP_SETTINGS,
	invites,
	memberships,
	movieNights,
	ratings,
	suggestions
} from './db/schema';
import {
	addMember,
	createGroup,
	deleteGroup,
	leaveGroup,
	listGroupsFor,
	listMembers,
	requireMember,
	requireOwner,
	requireUser
} from './groups';
import { createInvite } from './invites';
import { drawForNight, respond, scheduleNight } from './nights';
import { saveRating } from './ratings';
import { addSuggestion } from './suggestions';
import { createUser, userProfile } from './users';

let db: DB;
let ada: string;
let grace: string;

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
});

function status(fn: () => unknown): number | undefined {
	try {
		fn();
	} catch (e) {
		return (e as { status?: number }).status;
	}
}

describe('createGroup', () => {
	it('makes the creator an owner member in one transaction', () => {
		const id = createGroup(db, { name: 'Movie Club', ownerId: ada });
		expect(requireMember(db, ada, id).role).toBe('owner');
	});

	it('applies the default settings from the PRD', () => {
		const id = createGroup(db, { name: 'Movie Club', ownerId: ada });
		expect(requireMember(db, ada, id).settings).toEqual(DEFAULT_GROUP_SETTINGS);
	});
});

describe('requireMember', () => {
	it('throws 404 — not 403 — for a non-member, so the id is not confirmed', () => {
		const id = createGroup(db, { name: 'Movie Club', ownerId: ada });
		expect(status(() => requireMember(db, grace, id))).toBe(404);
	});

	it('throws the same 404 for a group that does not exist', () => {
		expect(status(() => requireMember(db, ada, 'made-up-id'))).toBe(404);
	});

	it('throws 404 for a member who has left', () => {
		const id = createGroup(db, { name: 'Movie Club', ownerId: ada });
		addMember(db, grace, id);
		leaveGroup(db, grace, id);
		expect(status(() => requireMember(db, grace, id))).toBe(404);
	});
});

describe('addMember', () => {
	it('is idempotent', () => {
		const id = createGroup(db, { name: 'Movie Club', ownerId: ada });
		addMember(db, grace, id);
		addMember(db, grace, id);
		expect(listMembers(db, id)).toHaveLength(2);
	});

	it('re-activates someone who left rather than failing on the unique key', () => {
		const id = createGroup(db, { name: 'Movie Club', ownerId: ada });
		addMember(db, grace, id);
		leaveGroup(db, grace, id);
		addMember(db, grace, id);
		expect(requireMember(db, grace, id).role).toBe('member');
	});
});

describe('listGroupsFor', () => {
	it('lists only the groups the user is currently in', () => {
		const mine = createGroup(db, { name: 'Mine', ownerId: ada });
		createGroup(db, { name: 'Theirs', ownerId: grace });
		expect(listGroupsFor(db, ada)).toEqual([
			{ id: mine, name: 'Mine', emoji: null, role: 'owner' }
		]);
	});

	it('drops a group once its member has left', () => {
		const id = createGroup(db, { name: 'Movie Club', ownerId: ada });
		addMember(db, grace, id);
		leaveGroup(db, grace, id);
		expect(listGroupsFor(db, grace)).toEqual([]);
	});
});

describe('listMembers', () => {
	it('drops a member once they have left', () => {
		const id = createGroup(db, { name: 'Movie Club', ownerId: ada });
		addMember(db, grace, id);
		leaveGroup(db, grace, id);
		expect(listMembers(db, id)).toEqual([{ id: ada, displayName: 'Ada', role: 'owner' }]);
	});
});

describe('requireUser', () => {
	it('returns the user when signed in', () => {
		const user = { id: 'u1', displayName: 'Ada', isAdmin: false };
		expect(requireUser({ user, locale: 'en' })).toBe(user);
	});

	it('throws 401 when signed out', () => {
		expect(status(() => requireUser({ user: null, locale: 'en' }))).toBe(401);
	});
});

describe('requireOwner', () => {
	it('returns the membership for the owner', () => {
		const id = createGroup(db, { name: 'Movie Club', ownerId: ada });
		expect(requireOwner(db, ada, id).role).toBe('owner');
	});

	it('throws 403 for a member who is not the owner', () => {
		const id = createGroup(db, { name: 'Movie Club', ownerId: ada });
		addMember(db, grace, id);
		expect(status(() => requireOwner(db, grace, id))).toBe(403);
	});

	it('throws 404 — not 403 — for a non-member, so the id is not confirmed', () => {
		const id = createGroup(db, { name: 'Movie Club', ownerId: ada });
		expect(status(() => requireOwner(db, grace, id))).toBe(404);
	});

	it('throws 404 for a group that does not exist', () => {
		expect(status(() => requireOwner(db, ada, 'made-up-id'))).toBe(404);
	});
});

describe('deleteGroup', () => {
	it('removes the group and everything in it, and nothing else', () => {
		const doomed = createGroup(db, { name: 'Doomed', ownerId: ada });
		const kept = createGroup(db, { name: 'Kept', ownerId: ada });
		addMember(db, grace, doomed);
		createInvite(db, { groupId: doomed, createdBy: ada });
		for (const [groupId, userId] of [
			[doomed, grace],
			[kept, ada]
		]) {
			addSuggestion(db, {
				groupId,
				userId,
				movie: { title: 'Dune' },
				settings: DEFAULT_GROUP_SETTINGS
			});
		}
		// A night that has ended, so it can carry an RSVP and a rating too.
		const night = scheduleNight(db, {
			groupId: doomed,
			userId: ada,
			scheduledAt: new Date(Date.now() - 5 * 3_600_000),
			location: null
		});
		drawForNight(db, night, ada);
		respond(db, night, grace, 'yes');
		expect(
			saveRating(db, { nightId: night, userId: grace, scoreX2: 14, comment: null, now: new Date() })
				.ok
		).toBe(true);

		deleteGroup(db, doomed);

		expect(listGroupsFor(db, ada).map((g) => g.name)).toEqual(['Kept']);
		expect(listGroupsFor(db, grace)).toEqual([]);
		const count = (table: SQLiteTable) => db.select().from(table).all().length;
		expect(count(memberships)).toBe(1); // ada in Kept
		expect(count(suggestions)).toBe(1); // Kept's Dune
		expect(count(invites)).toBe(0);
		expect(count(movieNights)).toBe(0);
		expect(count(attendance)).toBe(0);
		expect(count(ratings)).toBe(0);
		expect(userProfile(db, grace)).not.toBeNull();
	});
});
