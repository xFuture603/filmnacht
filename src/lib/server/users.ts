import Database from 'better-sqlite3';
import { eq } from 'drizzle-orm';
import type { SessionUser } from './auth/session';
import { generateToken, hashToken } from './auth/tokens';
import type { DB } from './db/client';
import { users } from './db/schema';
import { FORMER_MEMBER_USERNAME } from './members';

export const DISPLAY_NAME_MAX = 60;
export const USERNAME_MIN = 3;
export const USERNAME_MAX = 32;

/**
 * Deliberately ASCII-only and lowercased. Two members must never be able to
 * hold usernames that look identical — allowing Unicode would let someone
 * register a Cyrillic "а" that renders exactly like the Latin one next to it,
 * and the whole point of this field is that it identifies exactly one account.
 * Display names have no such restriction: they are free-form and may collide.
 */
export function validateUsername(raw: FormDataEntryValue | null): string | null {
	const username = String(raw ?? '')
		.trim()
		.toLowerCase();
	if (username.length < USERNAME_MIN || username.length > USERNAME_MAX) return null;
	if (!/^[a-z0-9._-]+$/.test(username)) return null;
	// A username of only dots or separators identifies nobody and is the sort
	// of thing that later turns into a path-handling surprise ('...', '.').
	if (!/[a-z0-9]/.test(username)) return null;
	// Reserved for the "former member" placeholder (members.ts). Without this,
	// a real person could register it through join or setup before the
	// placeholder row exists, and formerMemberId would then adopt that real,
	// signable-in account instead of creating its own.
	if (username === FORMER_MEMBER_USERNAME) return null;
	return username;
}

/**
 * Thrown by createUser when the username collides with an existing account.
 * usernameTaken (used by every caller) is a pre-check, not a guarantee — a
 * second submission can still race past it while the first one spends ~100ms
 * hashing its password. The unique index on users.username is the actual
 * guarantee; this turns its violation into something a caller can translate
 * instead of letting a raw SqliteError become an unhandled 500.
 */
export class UsernameTakenError extends Error {}

export function createUser(
	db: DB,
	input: {
		username: string;
		displayName: string;
		passwordHash: string;
		isAdmin?: boolean;
		/** Already validated (validateEmail); stored in the same insert as the account. */
		email?: string | null;
	}
): SessionUser {
	const id = crypto.randomUUID();
	const isAdmin = input.isAdmin ?? false;
	// Normalised here too, not just by validateUsername: the case-insensitive
	// lookup in userByUsername/usernameTaken must hold as a property of this
	// function, not as an accident of every caller pre-normalising.
	const username = input.username.trim().toLowerCase();
	try {
		// A login token is minted so the column is never null; it is not shown
		// anywhere. The profile's reveal action regenerates it.
		db.insert(users)
			.values({
				id,
				username,
				displayName: input.displayName,
				passwordHash: input.passwordHash,
				isAdmin,
				loginTokenHash: hashToken(generateToken()),
				email: input.email?.trim().toLowerCase() || null
			})
			.run();
	} catch (err) {
		if (
			err instanceof Database.SqliteError &&
			err.code === 'SQLITE_CONSTRAINT_UNIQUE' &&
			err.message.includes('users.email')
		) {
			throw new EmailTakenError(input.email ?? '');
		}
		// Matched narrowly on the username column specifically, not on the
		// generic UNIQUE code alone: users.login_token_hash is also unique, and
		// mislabelling that astronomically unlikely collision as "username
		// taken" would hide a real bug behind a wrong, reassuring message.
		// Anything else — including a login-token collision — is rethrown.
		if (
			err instanceof Database.SqliteError &&
			err.code === 'SQLITE_CONSTRAINT_UNIQUE' &&
			err.message.includes('users.username')
		) {
			throw new UsernameTakenError(username);
		}
		throw err;
	}
	return { id, displayName: input.displayName, isAdmin };
}

export function regenerateLoginToken(db: DB, userId: string): string {
	const token = generateToken();
	db.update(users)
		.set({ loginTokenHash: hashToken(token) })
		.where(eq(users.id, userId))
		.run();
	return token;
}

export function userByLoginToken(db: DB, token: string): SessionUser | null {
	const row = db
		.select({ id: users.id, displayName: users.displayName, isAdmin: users.isAdmin })
		.from(users)
		.where(eq(users.loginTokenHash, hashToken(token)))
		.get();
	return row ?? null;
}

/**
 * Returns only what a credential check needs. The display name is deliberately
 * absent: the login page has no business knowing it before authentication, and
 * a narrower return is one fewer thing to leak into an error or a log.
 */
export function userByUsername(
	db: DB,
	username: string
): { id: string; username: string; passwordHash: string } | null {
	const row = db
		.select({ id: users.id, username: users.username, passwordHash: users.passwordHash })
		.from(users)
		.where(eq(users.username, username.trim().toLowerCase()))
		.get();
	return row ?? null;
}

/**
 * Returns only the id, and that is the point: the caller is an
 * enumeration-safe route, and handing it a whole user row invites a branch
 * that behaves differently for an address that exists. Matches lowercased
 * because setEmail normalises before writing, so the stored bytes are already
 * lowercase and an address that differs only in case is the same account.
 */
export function userByEmail(db: DB, email: string): { id: string } | null {
	const row = db
		.select({ id: users.id })
		.from(users)
		.where(eq(users.email, email.trim().toLowerCase()))
		.get();
	return row ?? null;
}

export function setPassword(db: DB, userId: string, passwordHash: string): void {
	db.update(users).set({ passwordHash }).where(eq(users.id, userId)).run();
}

export function usernameTaken(db: DB, username: string): boolean {
	return userByUsername(db, username) !== null;
}

/**
 * Everything the profile page shows, and deliberately nothing else — the
 * password hash in particular, which this return value is serialised straight
 * into the browser. Keep it that way: a `passwordHash` added here for one
 * action's convenience ships the hash to every visitor of /profile.
 */
export function userProfile(
	db: DB,
	userId: string
): {
	username: string;
	displayName: string;
	email: string | null;
	ratingMails: boolean;
	nightMails: boolean;
} | null {
	return (
		db
			.select({
				username: users.username,
				displayName: users.displayName,
				email: users.email,
				ratingMails: users.ratingMails,
				nightMails: users.nightMails
			})
			.from(users)
			.where(eq(users.id, userId))
			.get() ?? null
	);
}

export function setMailPrefs(
	db: DB,
	userId: string,
	prefs: { ratingMails: boolean; nightMails: boolean }
): void {
	db.update(users).set(prefs).where(eq(users.id, userId)).run();
}

/** For the current-password check, which knows the id but not the username. */
export function storedPasswordHash(db: DB, userId: string): string | null {
	const row = db
		.select({ passwordHash: users.passwordHash })
		.from(users)
		.where(eq(users.id, userId))
		.get();
	return row?.passwordHash ?? null;
}

export function setDisplayName(db: DB, userId: string, displayName: string): void {
	db.update(users).set({ displayName }).where(eq(users.id, userId)).run();
}

/**
 * Thrown when the address already belongs to another account. The unique index
 * is the guarantee; this is what turns its violation into something a route can
 * translate instead of a 500. Note the message it produces does confirm that an
 * address has an account on this instance — accepted for a private 3-12 person
 * group, where the members already know each other, in exchange for an error a
 * person can act on.
 */
export class EmailTakenError extends Error {}

/**
 * Normalises before writing, and that is load-bearing rather than tidy: the
 * unique index compares bytes, so without lowercasing here `Ada@x.com` and
 * `ada@x.com` are two accounts with one address between them — and Plan 4 has
 * to resolve an address back to exactly one account. An empty value clears the
 * column to NULL, never to '', so the constraint keeps permitting any number of
 * accounts with no address.
 */
export function setEmail(db: DB, userId: string, email: string | null): void {
	const normalised = email?.trim().toLowerCase() || null;
	try {
		db.update(users).set({ email: normalised }).where(eq(users.id, userId)).run();
	} catch (err) {
		// Matched on users.email specifically, exactly as createUser matches
		// users.username: three columns on this table are unique, and labelling a
		// login-token collision "that address is taken" would hide a real bug
		// behind a wrong, reassuring message. Anything else is rethrown.
		if (
			err instanceof Database.SqliteError &&
			err.code === 'SQLITE_CONSTRAINT_UNIQUE' &&
			err.message.includes('users.email')
		) {
			throw new EmailTakenError(normalised ?? '');
		}
		throw err;
	}
}

/** The RFC 5321 bound on a whole address. Not a security limit, just a cap. */
export const EMAIL_MAX = 254;

/**
 * Deliberately not an RFC 5322 regex. The only definitive test of an address is
 * sending to it, which is Plan 4's job; anything more elaborate here would only
 * reject valid addresses more confidently. `x@y.z` with no spaces is the level
 * of strictness that catches a typo without pretending to be a validator.
 *
 * Returns '' for empty input, which means "clear it" — distinct from null,
 * which means the caller should show an error.
 */
export function validateEmail(raw: FormDataEntryValue | null): string | null {
	const email = String(raw ?? '')
		.trim()
		.toLowerCase();
	if (!email) return '';
	if (email.length > EMAIL_MAX) return null;
	return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null;
}

export function validateDisplayName(raw: FormDataEntryValue | null): string | null {
	const name = String(raw ?? '').trim();
	if (!name || name.length > DISPLAY_NAME_MAX) return null;
	return name;
}
