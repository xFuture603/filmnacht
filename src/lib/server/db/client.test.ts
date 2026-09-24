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
		db.insert(users)
			.values({
				displayName: 'Ada',
				username: 'ada',
				passwordHash: 'x',
				loginTokenHash: 'hash-a'
			})
			.run();
		const row = db.select().from(users).where(eq(users.displayName, 'Ada')).get();
		expect(row?.id).toMatch(/^[0-9a-f-]{36}$/);
		expect(row?.createdAt).toBeInstanceOf(Date);
		expect(row?.isAdmin).toBe(false);
		expect(row?.email).toBeNull();
	});

	it('rejects a second user with the same login token hash', () => {
		const db = testDb();
		db.insert(users)
			.values({ displayName: 'Ada', username: 'ada', passwordHash: 'x', loginTokenHash: 'dup' })
			.run();
		expect(() =>
			db
				.insert(users)
				.values({
					displayName: 'Grace',
					username: 'grace',
					passwordHash: 'y',
					loginTokenHash: 'dup'
				})
				.run()
		).toThrow();
	});

	it('stores group settings as JSON and returns them as an object', () => {
		const db = testDb();
		db.insert(users)
			.values({
				id: 'u1',
				displayName: 'Ada',
				username: 'ada',
				passwordHash: 'x',
				loginTokenHash: 'h'
			})
			.run();
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

describe('user credentials', () => {
	it('refuses a user with no username', () => {
		const db = testDb();
		expect(() =>
			db
				.insert(users)
				.values({ displayName: 'Ada', passwordHash: 'x', loginTokenHash: 'h' } as never)
				.run()
		).toThrow();
	});

	it('refuses a user with no password hash', () => {
		const db = testDb();
		expect(() =>
			db
				.insert(users)
				.values({ displayName: 'Ada', username: 'ada', loginTokenHash: 'h' } as never)
				.run()
		).toThrow();
	});

	it('refuses two users with the same username', () => {
		const db = testDb();
		db.insert(users)
			.values({ displayName: 'Ada', username: 'ada', passwordHash: 'x', loginTokenHash: 'h1' })
			.run();
		expect(() =>
			db
				.insert(users)
				.values({ displayName: 'Other', username: 'ada', passwordHash: 'y', loginTokenHash: 'h2' })
				.run()
		).toThrow();
	});

	it('allows two users to share a display name', () => {
		const db = testDb();
		db.insert(users)
			.values({ displayName: 'Alex', username: 'alex1', passwordHash: 'x', loginTokenHash: 'h1' })
			.run();
		db.insert(users)
			.values({ displayName: 'Alex', username: 'alex2', passwordHash: 'y', loginTokenHash: 'h2' })
			.run();
		expect(db.select().from(users).all()).toHaveLength(2);
	});
});

describe('user email', () => {
	it('allows many accounts with no email, because it is genuinely optional', () => {
		const db = testDb();
		db.insert(users)
			.values({ displayName: 'Ada', username: 'ada', passwordHash: 'x', loginTokenHash: 'h1' })
			.run();
		db.insert(users)
			.values({ displayName: 'Grace', username: 'grace', passwordHash: 'y', loginTokenHash: 'h2' })
			.run();
		expect(db.select().from(users).all()).toHaveLength(2);
	});

	it('refuses two accounts with the same email', () => {
		// Plan 4 resolves an address back to ONE account to send a reset link.
		// Two accounts sharing an address makes that ambiguous, and "which of
		// these two do I send the reset to" has no safe answer.
		const db = testDb();
		db.insert(users)
			.values({
				displayName: 'Ada',
				username: 'ada',
				email: 'ada@example.com',
				passwordHash: 'x',
				loginTokenHash: 'h1'
			})
			.run();
		expect(() =>
			db
				.insert(users)
				.values({
					displayName: 'Other',
					username: 'other',
					email: 'ada@example.com',
					passwordHash: 'y',
					loginTokenHash: 'h2'
				})
				.run()
		).toThrow();
	});

	it('does NOT fold case, which is why setEmail has to lowercase', () => {
		// Verified against better-sqlite3: UNIQUE here is byte comparison, so the
		// constraint alone would let Ada@x.com and ada@x.com both exist and both
		// be a valid reset target. The normalisation in setEmail is required, not
		// a nicety. If SQLite ever changed this the test would fail, which is the
		// point: the reason for that normalisation would have gone away.
		const db = testDb();
		db.insert(users)
			.values({
				displayName: 'Ada',
				username: 'ada',
				email: 'ada@example.com',
				passwordHash: 'x',
				loginTokenHash: 'h1'
			})
			.run();
		expect(() =>
			db
				.insert(users)
				.values({
					displayName: 'Other',
					username: 'other',
					email: 'Ada@example.com',
					passwordHash: 'y',
					loginTokenHash: 'h2'
				})
				.run()
		).not.toThrow();
	});
});
