import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { hashPassword } from './auth/password';
import { hashToken } from './auth/tokens';
import { applyMigrations, createDb, type DB } from './db/client';
import { users } from './db/schema';
import {
	createUser,
	regenerateLoginToken,
	setPassword,
	USERNAME_MAX,
	userByLoginToken,
	userByUsername,
	usernameTaken,
	validateDisplayName,
	validateUsername
} from './users';

let db: DB;

beforeEach(() => {
	db = createDb(':memory:').db;
	applyMigrations(db);
});

const PLACEHOLDER_HASH = 'scrypt$placeholder$placeholder';

describe('createUser', () => {
	it('creates a member by default', () => {
		const user = createUser(db, {
			username: 'ada',
			displayName: 'Ada',
			passwordHash: PLACEHOLDER_HASH
		});
		expect(user.displayName).toBe('Ada');
		expect(user.isAdmin).toBe(false);
	});

	it('can create the instance admin', () => {
		const user = createUser(db, {
			username: 'root',
			displayName: 'Root',
			passwordHash: PLACEHOLDER_HASH,
			isAdmin: true
		});
		expect(user.isAdmin).toBe(true);
	});

	it('stores a login token hash that is not derivable from the row', () => {
		const user = createUser(db, {
			username: 'ada',
			displayName: 'Ada',
			passwordHash: PLACEHOLDER_HASH
		});
		const row = db.select().from(users).where(eq(users.id, user.id)).get();
		expect(row?.loginTokenHash).toMatch(/^[0-9a-f]{64}$/);
	});

	it('gives two users with the same name different tokens', () => {
		createUser(db, { username: 'ada1', displayName: 'Ada', passwordHash: PLACEHOLDER_HASH });
		createUser(db, { username: 'ada2', displayName: 'Ada', passwordHash: PLACEHOLDER_HASH });
		const rows = db.select().from(users).where(eq(users.displayName, 'Ada')).all();
		expect(rows).toHaveLength(2);
		expect(rows[0].loginTokenHash).not.toBe(rows[1].loginTokenHash);
	});
});

describe('regenerateLoginToken', () => {
	it('returns a token that resolves back to the user', () => {
		const user = createUser(db, {
			username: 'ada',
			displayName: 'Ada',
			passwordHash: PLACEHOLDER_HASH
		});
		const token = regenerateLoginToken(db, user.id);
		expect(userByLoginToken(db, token)).toEqual(user);
	});

	it('invalidates the previous token', () => {
		const user = createUser(db, {
			username: 'ada',
			displayName: 'Ada',
			passwordHash: PLACEHOLDER_HASH
		});
		const first = regenerateLoginToken(db, user.id);
		regenerateLoginToken(db, user.id);
		expect(userByLoginToken(db, first)).toBeNull();
	});

	it('stores the hash, not the token', () => {
		const user = createUser(db, {
			username: 'ada',
			displayName: 'Ada',
			passwordHash: PLACEHOLDER_HASH
		});
		const token = regenerateLoginToken(db, user.id);
		const row = db.select().from(users).where(eq(users.id, user.id)).get();
		expect(row?.loginTokenHash).toBe(hashToken(token));
	});
});

describe('userByLoginToken', () => {
	it('returns null for an unknown token', () => {
		createUser(db, { username: 'ada', displayName: 'Ada', passwordHash: PLACEHOLDER_HASH });
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

describe('login link round trip', () => {
	it('signs in the right user and only that user', () => {
		const ada = createUser(db, {
			username: 'ada',
			displayName: 'Ada',
			passwordHash: PLACEHOLDER_HASH
		});
		const grace = createUser(db, {
			username: 'grace',
			displayName: 'Grace',
			passwordHash: PLACEHOLDER_HASH
		});
		const adaToken = regenerateLoginToken(db, ada.id);
		const graceToken = regenerateLoginToken(db, grace.id);
		expect(userByLoginToken(db, adaToken)?.id).toBe(ada.id);
		expect(userByLoginToken(db, graceToken)?.id).toBe(grace.id);
	});

	it('revoking by revealing again makes the old link dead on arrival', () => {
		const ada = createUser(db, {
			username: 'ada',
			displayName: 'Ada',
			passwordHash: PLACEHOLDER_HASH
		});
		const old = regenerateLoginToken(db, ada.id);
		const fresh = regenerateLoginToken(db, ada.id);
		expect(userByLoginToken(db, old)).toBeNull();
		expect(userByLoginToken(db, fresh)?.id).toBe(ada.id);
	});
});

describe('validateUsername', () => {
	it('accepts a plain username and lowercases it', () => {
		expect(validateUsername('Ada')).toBe('ada');
	});

	it('trims surrounding whitespace', () => {
		expect(validateUsername('  ada  ')).toBe('ada');
	});

	it('accepts letters, digits, underscore, hyphen and dot', () => {
		expect(validateUsername('ada.l_1-x')).toBe('ada.l_1-x');
	});

	it('rejects characters that would be confusing in a URL or a log line', () => {
		expect(validateUsername('ada lovelace')).toBeNull();
		expect(validateUsername('ada@example.com')).toBeNull();
		expect(validateUsername('ada/../root')).toBeNull();
	});

	it('rejects non-ASCII, so two usernames cannot look identical', () => {
		// "аdа" here uses Cyrillic а. Allowing it would let one member register a
		// username visually indistinguishable from another's.
		expect(validateUsername('аdа')).toBeNull();
	});

	it('enforces the length bounds', () => {
		expect(validateUsername('ab')).toBeNull();
		expect(validateUsername('a'.repeat(USERNAME_MAX))).toHaveLength(USERNAME_MAX);
		expect(validateUsername('a'.repeat(USERNAME_MAX + 1))).toBeNull();
	});

	it('rejects empty and non-string input', () => {
		expect(validateUsername('')).toBeNull();
		expect(validateUsername(null)).toBeNull();
	});

	it('rejects a username with no letters or digits', () => {
		// '...' and '-_-' are 3 characters, satisfy the length bound and use only
		// characters the charset regex already allows — without the alnum check
		// both would sail through and identify nobody.
		expect(validateUsername('...')).toBeNull();
		expect(validateUsername('-_-')).toBeNull();
		// Also below the length bound on its own, but listed because the brief
		// calls it out explicitly as a case that must be rejected.
		expect(validateUsername('.')).toBeNull();
	});

	it('accepts a letter or digit combined with separators', () => {
		expect(validateUsername('a.b')).toBe('a.b');
		expect(validateUsername('a-b')).toBe('a-b');
		expect(validateUsername('a_b')).toBe('a_b');
	});
});

describe('createUser with a username', () => {
	it('stores the username and the password hash', async () => {
		const hash = await hashPassword('correct horse battery');
		const user = createUser(db, { username: 'ada', displayName: 'Ada', passwordHash: hash });
		const row = db.select().from(users).where(eq(users.id, user.id)).get();
		expect(row?.username).toBe('ada');
		expect(row?.passwordHash).toBe(hash);
	});

	it('still allows two members to share a display name', async () => {
		const hash = await hashPassword('a password');
		createUser(db, { username: 'alex1', displayName: 'Alex', passwordHash: hash });
		expect(() =>
			createUser(db, { username: 'alex2', displayName: 'Alex', passwordHash: hash })
		).not.toThrow();
	});

	it('refuses two members with the same username', async () => {
		const hash = await hashPassword('a password');
		createUser(db, { username: 'ada', displayName: 'Ada', passwordHash: hash });
		expect(() =>
			createUser(db, { username: 'ada', displayName: 'Someone Else', passwordHash: hash })
		).toThrow();
	});

	it('lowercases and trims its own input, independent of any caller pre-normalising', async () => {
		const hash = await hashPassword('a password');
		const user = createUser(db, { username: '  Ada  ', displayName: 'Ada', passwordHash: hash });
		const row = db.select().from(users).where(eq(users.id, user.id)).get();
		expect(row?.username).toBe('ada');
	});

	it('still refuses a collision that only differs by case or padding', async () => {
		const hash = await hashPassword('a password');
		createUser(db, { username: 'ada', displayName: 'Ada', passwordHash: hash });
		expect(() =>
			createUser(db, { username: '  ADA  ', displayName: 'Someone Else', passwordHash: hash })
		).toThrow();
	});
});

describe('userByUsername', () => {
	it('finds the account and returns what a login check needs', async () => {
		const hash = await hashPassword('secret password');
		const user = createUser(db, { username: 'ada', displayName: 'Ada', passwordHash: hash });
		expect(userByUsername(db, 'ada')).toEqual({
			id: user.id,
			username: 'ada',
			passwordHash: hash
		});
	});

	it('is case-insensitive, because the username is stored lowercased', async () => {
		createUser(db, {
			username: 'ada',
			displayName: 'Ada',
			passwordHash: await hashPassword('a password')
		});
		expect(userByUsername(db, 'ADA')?.username).toBe('ada');
	});

	it('returns null for an unknown username', async () => {
		createUser(db, {
			username: 'ada',
			displayName: 'Ada',
			passwordHash: await hashPassword('a password')
		});
		expect(userByUsername(db, 'grace')).toBeNull();
	});

	it('never returns the display name or anything else the login page does not need', async () => {
		createUser(db, {
			username: 'ada',
			displayName: 'Ada',
			passwordHash: await hashPassword('a password')
		});
		expect(Object.keys(userByUsername(db, 'ada') ?? {}).sort()).toEqual([
			'id',
			'passwordHash',
			'username'
		]);
	});
});

describe('setPassword', () => {
	it('replaces the stored hash', async () => {
		const user = createUser(db, {
			username: 'ada',
			displayName: 'Ada',
			passwordHash: await hashPassword('old password')
		});
		const fresh = await hashPassword('new password');
		setPassword(db, user.id, fresh);
		expect(userByUsername(db, 'ada')?.passwordHash).toBe(fresh);
	});

	it('leaves every other account untouched', async () => {
		const ada = createUser(db, {
			username: 'ada',
			displayName: 'Ada',
			passwordHash: await hashPassword('ada password')
		});
		const graceHash = await hashPassword('grace password');
		createUser(db, { username: 'grace', displayName: 'Grace', passwordHash: graceHash });
		setPassword(db, ada.id, await hashPassword('ada new password'));
		expect(userByUsername(db, 'grace')?.passwordHash).toBe(graceHash);
	});
});

describe('usernameTaken', () => {
	it('reports a username already in use', async () => {
		createUser(db, {
			username: 'ada',
			displayName: 'Ada',
			passwordHash: await hashPassword('a password')
		});
		expect(usernameTaken(db, 'ada')).toBe(true);
		expect(usernameTaken(db, 'grace')).toBe(false);
	});

	it('matches case-insensitively', async () => {
		createUser(db, {
			username: 'ada',
			displayName: 'Ada',
			passwordHash: await hashPassword('a password')
		});
		expect(usernameTaken(db, 'ADA')).toBe(true);
	});
});
