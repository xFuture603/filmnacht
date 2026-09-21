import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { applyMigrations, createDb, type DB } from '../db/client';
import { sessions, users } from '../db/schema';
import { generateToken, hashToken } from './tokens';
import { createSession, deleteSession, SESSION_TTL_MS, validateSession } from './session';

let db: DB;

beforeEach(() => {
	db = createDb(':memory:').db;
	applyMigrations(db);
	db.insert(users).values({ id: 'u1', displayName: 'Ada', loginTokenHash: 'h1' }).run();
});

describe('generateToken', () => {
	it('produces at least 128 bits of entropy, URL-safe', () => {
		const token = generateToken();
		expect(token).toMatch(/^[A-Za-z0-9_-]{22}$/); // 16 bytes base64url
		expect(Buffer.from(token, 'base64url')).toHaveLength(16);
	});

	it('does not repeat', () => {
		const seen = new Set(Array.from({ length: 500 }, generateToken));
		expect(seen.size).toBe(500);
	});
});

describe('createSession', () => {
	it('stores the hash, never the token itself', () => {
		const { token } = createSession(db, 'u1');
		const row = db.select().from(sessions).get();
		expect(row?.id).toBe(hashToken(token));
		expect(row?.id).not.toBe(token);
	});
});

describe('validateSession', () => {
	it('returns the user for a live token', () => {
		const { token } = createSession(db, 'u1');
		expect(validateSession(db, token)?.user).toEqual({
			id: 'u1',
			displayName: 'Ada',
			isAdmin: false
		});
	});

	it('returns null for an unknown token', () => {
		expect(validateSession(db, generateToken())).toBeNull();
	});

	it('returns null for an expired token and deletes the row', () => {
		const start = Date.UTC(2026, 0, 1);
		const { token } = createSession(db, 'u1', start);
		expect(validateSession(db, token, start + SESSION_TTL_MS + 1)).toBeNull();
		expect(db.select().from(sessions).all()).toHaveLength(0);
	});

	it('slides the expiry once the session is past its halfway point', () => {
		const start = Date.UTC(2026, 0, 1);
		const { token } = createSession(db, 'u1', start);
		const later = start + SESSION_TTL_MS * 0.6;
		const result = validateSession(db, token, later);
		expect(result?.refreshed).toBe(true);
		expect(result?.expiresAt.getTime()).toBe(later + SESSION_TTL_MS);
	});

	it('does not slide a fresh session', () => {
		const start = Date.UTC(2026, 0, 1);
		const { token } = createSession(db, 'u1', start);
		expect(validateSession(db, token, start + 1000)?.refreshed).toBe(false);
	});
});

describe('deleteSession', () => {
	it('removes the row so the token stops working', () => {
		const { token } = createSession(db, 'u1');
		deleteSession(db, token);
		expect(validateSession(db, token)).toBeNull();
	});
});

describe('cascade', () => {
	it('drops sessions when the user is deleted', () => {
		const { token } = createSession(db, 'u1');
		db.delete(users).where(eq(users.id, 'u1')).run();
		expect(validateSession(db, token)).toBeNull();
	});
});
