import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { applyMigrations, createDb } from './client';
import { DEFAULT_GROUP_SETTINGS, groups, users } from './schema';

function testDb() {
	const { db } = createDb(':memory:');
	applyMigrations(db);
	return db;
}

describe('createDb', () => {
	it('enables foreign key enforcement', () => {
		const { sqlite } = createDb(':memory:');
		expect(sqlite.pragma('foreign_keys', { simple: true })).toBe(1);
	});

	it('round-trips a user with a generated id and timestamp', () => {
		const db = testDb();
		db.insert(users).values({ displayName: 'Ada', loginTokenHash: 'hash-a' }).run();
		const row = db.select().from(users).where(eq(users.displayName, 'Ada')).get();
		expect(row?.id).toMatch(/^[0-9a-f-]{36}$/);
		expect(row?.createdAt).toBeInstanceOf(Date);
		expect(row?.isAdmin).toBe(false);
		expect(row?.email).toBeNull();
	});

	it('rejects a second user with the same login token hash', () => {
		const db = testDb();
		db.insert(users).values({ displayName: 'Ada', loginTokenHash: 'dup' }).run();
		expect(() =>
			db.insert(users).values({ displayName: 'Grace', loginTokenHash: 'dup' }).run()
		).toThrow();
	});

	it('stores group settings as JSON and returns them as an object', () => {
		const db = testDb();
		db.insert(users).values({ id: 'u1', displayName: 'Ada', loginTokenHash: 'h' }).run();
		db.insert(groups).values({ name: 'Movie Club', ownerId: 'u1' }).run();
		const group = db.select().from(groups).get();
		expect(group?.settings).toEqual(DEFAULT_GROUP_SETTINGS);
		expect(group?.settings.maxOpenSuggestions).toBe(3);
	});

	it('rejects a group whose owner does not exist', () => {
		const db = testDb();
		expect(() => db.insert(groups).values({ name: 'Ghosts', ownerId: 'nobody' }).run()).toThrow();
	});
});
