import { eq } from 'drizzle-orm';
import type { SessionUser } from './auth/session';
import { generateToken, hashToken } from './auth/tokens';
import type { DB } from './db/client';
import { users } from './db/schema';

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
	return username;
}

export function createUser(
	db: DB,
	input: { username: string; displayName: string; passwordHash: string; isAdmin?: boolean }
): SessionUser {
	const id = crypto.randomUUID();
	const isAdmin = input.isAdmin ?? false;
	// A login token is minted so the column is never null; it is not shown
	// anywhere. The profile's reveal action regenerates it.
	db.insert(users)
		.values({
			id,
			username: input.username,
			displayName: input.displayName,
			passwordHash: input.passwordHash,
			isAdmin,
			loginTokenHash: hashToken(generateToken())
		})
		.run();
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

export function setPassword(db: DB, userId: string, passwordHash: string): void {
	db.update(users).set({ passwordHash }).where(eq(users.id, userId)).run();
}

export function usernameTaken(db: DB, username: string): boolean {
	return userByUsername(db, username) !== null;
}

export function validateDisplayName(raw: FormDataEntryValue | null): string | null {
	const name = String(raw ?? '').trim();
	if (!name || name.length > DISPLAY_NAME_MAX) return null;
	return name;
}
