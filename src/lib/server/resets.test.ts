import { beforeEach, describe, expect, it } from 'vitest';
import { applyMigrations, createDb, type DB } from '$lib/server/db/client';
import { passwordResets } from '$lib/server/db/schema';
import { createUser } from '$lib/server/users';
import { consumeReset, createReset, RESET_TTL_MS } from './resets';

let db: DB;
let userId: string;

beforeEach(() => {
	db = createDb(':memory:').db;
	applyMigrations(db);
	userId = createUser(db, {
		username: 'ada',
		displayName: 'Ada',
		passwordHash: 'scrypt$placeholder$placeholder'
	}).id;
});

describe('reset tokens', () => {
	it('resolves a fresh token to its account', () => {
		const token = createReset(db, userId);
		expect(consumeReset(db, token)).toBe(userId);
	});

	it('refuses a token that has already been used', () => {
		// A reset link sits in a mailbox indefinitely; single use is the only
		// thing that bounds how long it stays dangerous.
		const token = createReset(db, userId);
		expect(consumeReset(db, token)).toBe(userId);
		expect(consumeReset(db, token)).toBeNull();
	});

	it('refuses a token that never existed', () => {
		expect(consumeReset(db, 'not-a-real-token')).toBeNull();
	});

	it('accepts a token just before it expires and refuses it just after', () => {
		// One SECOND either side, not one millisecond: expires_at is a seconds
		// column, so `minted + TTL` and `minted + TTL - 1ms` truncate to the same
		// stored value and a millisecond boundary would assert a distinction the
		// storage cannot represent. At ±1000ms the result is deterministic —
		// truncation moves the stored expiry down by at most 999ms, which can
		// never cross a full second.
		const minted = Date.now();
		const a = createReset(db, userId, minted);
		expect(consumeReset(db, a, minted + RESET_TTL_MS - 1000)).toBe(userId);

		const b = createReset(db, userId, minted);
		expect(consumeReset(db, b, minted + RESET_TTL_MS + 1000)).toBeNull();
	});

	it('does not let two callers spend one token', () => {
		// The check-yield-act shape, in the only form that matters here.
		const token = createReset(db, userId);
		const results = [consumeReset(db, token), consumeReset(db, token)];
		expect(results.filter((r) => r !== null)).toHaveLength(1);
	});

	it('keeps one account’s token from unlocking another', () => {
		const other = createUser(db, {
			username: 'grace',
			displayName: 'Grace',
			passwordHash: 'scrypt$placeholder$placeholder'
		}).id;
		const token = createReset(db, other);
		expect(consumeReset(db, token)).toBe(other);
		expect(consumeReset(db, token)).not.toBe(userId);
	});

	it('retires every outstanding token for the account, not just the one used', () => {
		// Found by mutation testing: nothing pinned this either way. Requesting a
		// reset twice and using the first link must not leave the second usable —
		// the password is about to change, and a credential that outlives the
		// change it authorised is the defect this project already shipped once.
		const first = createReset(db, userId);
		const second = createReset(db, userId);
		expect(consumeReset(db, first)).toBe(userId);
		expect(consumeReset(db, second)).toBeNull();
	});

	it('leaves another account’s outstanding token alone', () => {
		const other = createUser(db, {
			username: 'grace',
			displayName: 'Grace',
			passwordHash: 'scrypt$placeholder$placeholder'
		}).id;
		const mine = createReset(db, userId);
		const theirs = createReset(db, other);
		expect(consumeReset(db, mine)).toBe(userId);
		// Retiring my tokens must not retire hers.
		expect(consumeReset(db, theirs)).toBe(other);
	});

	it('stores no plaintext token', () => {
		const token = createReset(db, userId);
		const rows = db.select().from(passwordResets).all();
		expect(rows).toHaveLength(1);
		expect(JSON.stringify(rows)).not.toContain(token);
	});
});
