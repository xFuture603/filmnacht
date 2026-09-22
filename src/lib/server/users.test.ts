import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { hashToken } from './auth/tokens';
import { applyMigrations, createDb, type DB } from './db/client';
import { users } from './db/schema';
import { createUser, regenerateLoginToken, userByLoginToken, validateDisplayName } from './users';

let db: DB;

beforeEach(() => {
	db = createDb(':memory:').db;
	applyMigrations(db);
});

describe('createUser', () => {
	it('creates a member by default', () => {
		const user = createUser(db, 'Ada');
		expect(user.displayName).toBe('Ada');
		expect(user.isAdmin).toBe(false);
	});

	it('can create the instance admin', () => {
		expect(createUser(db, 'Root', true).isAdmin).toBe(true);
	});

	it('stores a login token hash that is not derivable from the row', () => {
		const user = createUser(db, 'Ada');
		const row = db.select().from(users).where(eq(users.id, user.id)).get();
		expect(row?.loginTokenHash).toMatch(/^[0-9a-f]{64}$/);
	});

	it('gives two users with the same name different tokens', () => {
		createUser(db, 'Ada');
		createUser(db, 'Ada');
		const rows = db.select().from(users).where(eq(users.displayName, 'Ada')).all();
		expect(rows).toHaveLength(2);
		expect(rows[0].loginTokenHash).not.toBe(rows[1].loginTokenHash);
	});
});

describe('regenerateLoginToken', () => {
	it('returns a token that resolves back to the user', () => {
		const user = createUser(db, 'Ada');
		const token = regenerateLoginToken(db, user.id);
		expect(userByLoginToken(db, token)).toEqual(user);
	});

	it('invalidates the previous token', () => {
		const user = createUser(db, 'Ada');
		const first = regenerateLoginToken(db, user.id);
		regenerateLoginToken(db, user.id);
		expect(userByLoginToken(db, first)).toBeNull();
	});

	it('stores the hash, not the token', () => {
		const user = createUser(db, 'Ada');
		const token = regenerateLoginToken(db, user.id);
		const row = db.select().from(users).where(eq(users.id, user.id)).get();
		expect(row?.loginTokenHash).toBe(hashToken(token));
	});
});

describe('userByLoginToken', () => {
	it('returns null for an unknown token', () => {
		createUser(db, 'Ada');
		expect(userByLoginToken(db, 'not-a-real-token')).toBeNull();
	});
});

describe('validateDisplayName', () => {
	it('trims and accepts a normal name', () => {
		expect(validateDisplayName('  Ada  ')).toBe('Ada');
	});

	it('rejects empty, whitespace-only and over-long names', () => {
		expect(validateDisplayName('')).toBeNull();
		expect(validateDisplayName('   ')).toBeNull();
		expect(validateDisplayName(null)).toBeNull();
		expect(validateDisplayName('x'.repeat(61))).toBeNull();
	});

	it('accepts a name exactly at the limit', () => {
		expect(validateDisplayName('x'.repeat(60))).toHaveLength(60);
	});
});
