import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { hashPassword } from './auth/password';
import { hashToken } from './auth/tokens';
import { applyMigrations, createDb, type DB } from './db/client';
import { users } from './db/schema';
import {
	EMAIL_MAX,
	EmailTakenError,
	UsernameTakenError,
	createUser,
	regenerateLoginToken,
	setDisplayName,
	setEmail,
	setPassword,
	storedPasswordHash,
	userProfile,
	USERNAME_MAX,
	userByEmail,
	userByLoginToken,
	userByUsername,
	usernameTaken,
	validateDisplayName,
	validateEmail,
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

	it('reserves the former-member placeholder username', () => {
		// Otherwise a real person could register it via join or setup before the
		// placeholder row exists, and formerMemberId would adopt that real,
		// signable-in account (see members.ts).
		expect(validateUsername('former-member')).toBeNull();
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

	it('throws UsernameTakenError specifically, not just any error', async () => {
		// Pins the behaviour to the error CLASS rather than to createUser's
		// internal string match against a better-sqlite3 message
		// ("UNIQUE constraint failed: users.username") — a dependency bump that
		// reworded that message would silently revert callers to an unhandled
		// 500 while a bare .toThrow() here would keep passing either way.
		const hash = await hashPassword('a password');
		createUser(db, { username: 'ada', displayName: 'Ada', passwordHash: hash });
		expect(() =>
			createUser(db, { username: 'ada', displayName: 'Someone Else', passwordHash: hash })
		).toThrow(UsernameTakenError);
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

describe('userByEmail', () => {
	function ada() {
		return createUser(db, { username: 'ada', displayName: 'Ada', passwordHash: PLACEHOLDER_HASH });
	}

	it('finds the account and returns nothing but its id', () => {
		const user = ada();
		setEmail(db, user.id, 'ada@example.com');
		expect(userByEmail(db, 'ada@example.com')).toEqual({ id: user.id });
	});

	it('is case-insensitive and ignores surrounding space', () => {
		// The caller is /reset, which normalises too — but the property belongs
		// to this function, not to the discipline of every future caller.
		const user = ada();
		setEmail(db, user.id, 'ada@example.com');
		expect(userByEmail(db, '  ADA@Example.COM ')).toEqual({ id: user.id });
	});

	it('returns null for an address nobody has', () => {
		ada();
		expect(userByEmail(db, 'grace@example.com')).toBeNull();
	});

	it('returns null for an empty address rather than an account with none', () => {
		// setEmail stores NULL, never '', for an account with no address. If it
		// ever stored '', an empty submission to /reset would resolve to whoever
		// was inserted first and mail them somebody else's reset link.
		ada();
		expect(userByEmail(db, '')).toBeNull();
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

describe('validateEmail', () => {
	it('accepts an ordinary address and lowercases it', () => {
		// Lowercased here AND in setEmail: the unique index is a byte comparison,
		// so without normalisation Ada@x.com and ada@x.com are two accounts with
		// one reset target between them.
		expect(validateEmail('Ada@Example.com')).toBe('ada@example.com');
	});

	it('trims surrounding whitespace', () => {
		expect(validateEmail('  ada@example.com  ')).toBe('ada@example.com');
	});

	it('treats empty input as "clear it", not as invalid', () => {
		expect(validateEmail('')).toBe('');
		expect(validateEmail('   ')).toBe('');
		expect(validateEmail(null)).toBe('');
	});

	it('rejects anything without the x@y.z shape', () => {
		expect(validateEmail('ada')).toBeNull();
		expect(validateEmail('ada@example')).toBeNull();
		expect(validateEmail('@example.com')).toBeNull();
		expect(validateEmail('ada@.com')).toBeNull();
		expect(validateEmail('ada example@x.com')).toBeNull();
		expect(validateEmail('ada@ex ample.com')).toBeNull();
	});

	it('rejects an absurdly long one', () => {
		expect(validateEmail(`${'a'.repeat(EMAIL_MAX)}@example.com`)).toBeNull();
	});
});

describe('setEmail', () => {
	function ada() {
		return createUser(db, {
			username: 'ada',
			displayName: 'Ada',
			passwordHash: PLACEHOLDER_HASH
		});
	}

	it('stores the address lowercased and trimmed', () => {
		const user = ada();
		setEmail(db, user.id, '  Ada@Example.COM ');
		expect(userProfile(db, user.id)?.email).toBe('ada@example.com');
	});

	it('clears the address when given null or an empty string', () => {
		const user = ada();
		setEmail(db, user.id, 'ada@example.com');
		setEmail(db, user.id, '');
		expect(userProfile(db, user.id)?.email).toBeNull();
		setEmail(db, user.id, 'ada@example.com');
		setEmail(db, user.id, null);
		expect(userProfile(db, user.id)?.email).toBeNull();
	});

	it('lets any number of accounts have no address at all', () => {
		const a = ada();
		const b = createUser(db, {
			username: 'grace',
			displayName: 'Grace',
			passwordHash: PLACEHOLDER_HASH
		});
		expect(() => {
			setEmail(db, a.id, '');
			setEmail(db, b.id, '');
		}).not.toThrow();
	});

	it('refuses an address another account already holds', () => {
		const a = ada();
		const b = createUser(db, {
			username: 'grace',
			displayName: 'Grace',
			passwordHash: PLACEHOLDER_HASH
		});
		setEmail(db, a.id, 'shared@example.com');
		expect(() => setEmail(db, b.id, 'shared@example.com')).toThrow(EmailTakenError);
	});

	it('refuses it regardless of the case it is typed in', () => {
		// The constraint alone does not catch this — SQLite compares bytes. This
		// test fails the moment the normalisation is dropped.
		const a = ada();
		const b = createUser(db, {
			username: 'grace',
			displayName: 'Grace',
			passwordHash: PLACEHOLDER_HASH
		});
		setEmail(db, a.id, 'shared@example.com');
		expect(() => setEmail(db, b.id, 'SHARED@Example.com')).toThrow(EmailTakenError);
	});

	it('lets an account re-set its own address', () => {
		const user = ada();
		setEmail(db, user.id, 'ada@example.com');
		expect(() => setEmail(db, user.id, 'ada@example.com')).not.toThrow();
	});
});

describe('setDisplayName', () => {
	it('replaces the name the group sees, leaving the username alone', () => {
		const user = createUser(db, {
			username: 'ada',
			displayName: 'Ada',
			passwordHash: PLACEHOLDER_HASH
		});
		setDisplayName(db, user.id, 'Ada L.');
		expect(userProfile(db, user.id)).toMatchObject({ displayName: 'Ada L.', username: 'ada' });
	});

	it('allows a duplicate, which is the whole reason usernames exist', () => {
		const a = createUser(db, {
			username: 'alex1',
			displayName: 'Alex',
			passwordHash: PLACEHOLDER_HASH
		});
		const b = createUser(db, {
			username: 'alex2',
			displayName: 'Other',
			passwordHash: PLACEHOLDER_HASH
		});
		setDisplayName(db, b.id, 'Alex');
		expect(userProfile(db, a.id)?.displayName).toBe('Alex');
		expect(userProfile(db, b.id)?.displayName).toBe('Alex');
	});
});

describe('userProfile', () => {
	it('never returns the password hash, which the page would send to the browser', () => {
		const user = createUser(db, {
			username: 'ada',
			displayName: 'Ada',
			passwordHash: PLACEHOLDER_HASH
		});
		expect(Object.keys(userProfile(db, user.id) ?? {}).sort()).toEqual([
			'displayName',
			'email',
			'nightMails',
			'ratingMails',
			'username'
		]);
	});

	it('returns null for an id no account holds', () => {
		expect(userProfile(db, crypto.randomUUID())).toBeNull();
	});
});

describe('storedPasswordHash', () => {
	it('returns the hash so a signed-in user current-password check can run', () => {
		const user = createUser(db, {
			username: 'ada',
			displayName: 'Ada',
			passwordHash: PLACEHOLDER_HASH
		});
		expect(storedPasswordHash(db, user.id)).toBe(PLACEHOLDER_HASH);
	});

	it('returns null for an id no account holds, rather than throwing', () => {
		// verifyPassword(pw, null) is false, so a deleted account mid-session
		// fails the check instead of crashing the action.
		expect(storedPasswordHash(db, crypto.randomUUID())).toBeNull();
	});
});
