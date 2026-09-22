import { beforeEach, describe, expect, it } from 'vitest';
import { applyMigrations, createDb, type DB } from './db/client';
import { DEFAULT_GROUP_SETTINGS } from './db/schema';
import {
	addMember,
	createGroup,
	leaveGroup,
	listGroupsFor,
	listMembers,
	requireMember
} from './groups';
import { createUser } from './users';

let db: DB;
let ada: string;
let grace: string;

beforeEach(() => {
	db = createDb(':memory:').db;
	applyMigrations(db);
	ada = createUser(db, 'Ada').id;
	grace = createUser(db, 'Grace').id;
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
