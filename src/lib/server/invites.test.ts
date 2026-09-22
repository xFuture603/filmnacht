import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { applyMigrations, createDb, type DB } from './db/client';
import { invites, memberships } from './db/schema';
import { createGroup, listMembers } from './groups';
import { createInvite, INVITE_TTL_DAYS, lookupInvite, redeemInvite } from './invites';
import { createUser } from './users';

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.UTC(2026, 8, 21);

let db: DB;
let ada: string;
let grace: string;
let groupId: string;

beforeEach(() => {
	db = createDb(':memory:').db;
	applyMigrations(db);
	ada = createUser(db, 'Ada').id;
	grace = createUser(db, 'Grace').id;
	groupId = createGroup(db, { name: 'Movie Club', ownerId: ada });
});

describe('createInvite', () => {
	it('returns a 128-bit token and stores only its hash', () => {
		const token = createInvite(db, { groupId, createdBy: ada, now: NOW });
		expect(token).toMatch(/^[A-Za-z0-9_-]{22}$/);
		const row = db.select().from(invites).get();
		expect(row?.tokenHash).not.toBe(token);
		expect(row?.uses).toBe(0);
		expect(row?.maxUses).toBeNull();
	});

	it('expires after seven days by default', () => {
		createInvite(db, { groupId, createdBy: ada, now: NOW });
		const row = db.select().from(invites).get();
		expect(row?.expiresAt.getTime()).toBe(NOW + INVITE_TTL_DAYS * DAY);
	});
});

describe('lookupInvite', () => {
	it('resolves a live token to its group', () => {
		const token = createInvite(db, { groupId, createdBy: ada, now: NOW });
		expect(lookupInvite(db, token, NOW + DAY)).toEqual({
			groupId,
			groupName: 'Movie Club',
			groupEmoji: null
		});
	});

	it('returns null once the token has expired', () => {
		const token = createInvite(db, { groupId, createdBy: ada, now: NOW });
		expect(lookupInvite(db, token, NOW + 8 * DAY)).toBeNull();
	});

	it('returns null for an unknown token', () => {
		expect(lookupInvite(db, 'not-a-real-token', NOW)).toBeNull();
	});

	it('returns null once the redemption cap is reached', () => {
		const token = createInvite(db, { groupId, createdBy: ada, maxUses: 1, now: NOW });
		redeemInvite(db, token, grace, NOW);
		expect(lookupInvite(db, token, NOW)).toBeNull();
	});
});

describe('redeemInvite', () => {
	it('adds the member and counts the use', () => {
		const token = createInvite(db, { groupId, createdBy: ada, now: NOW });
		expect(redeemInvite(db, token, grace, NOW)).toBe(groupId);
		expect(listMembers(db, groupId)).toHaveLength(2);
		expect(db.select().from(invites).get()?.uses).toBe(1);
	});

	it('is reusable by default', () => {
		const token = createInvite(db, { groupId, createdBy: ada, now: NOW });
		const carol = createUser(db, 'Carol').id;
		redeemInvite(db, token, grace, NOW);
		redeemInvite(db, token, carol, NOW);
		expect(listMembers(db, groupId)).toHaveLength(3);
	});

	it('does not count a second use for someone already in the group', () => {
		const token = createInvite(db, { groupId, createdBy: ada, now: NOW });
		redeemInvite(db, token, grace, NOW);
		expect(redeemInvite(db, token, grace, NOW)).toBe(groupId);
		expect(db.select().from(invites).get()?.uses).toBe(1);
		expect(db.select().from(memberships).where(eq(memberships.userId, grace)).all()).toHaveLength(
			1
		);
	});

	it('refuses an expired token without touching membership', () => {
		const token = createInvite(db, { groupId, createdBy: ada, now: NOW });
		expect(redeemInvite(db, token, grace, NOW + 8 * DAY)).toBeNull();
		expect(listMembers(db, groupId)).toHaveLength(1);
	});
});
