import { eq } from 'drizzle-orm';
import type { SessionUser } from './auth/session';
import { generateToken, hashToken } from './auth/tokens';
import type { DB } from './db/client';
import { users } from './db/schema';

export const DISPLAY_NAME_MAX = 60;

export function createUser(db: DB, displayName: string, isAdmin = false): SessionUser {
	const id = crypto.randomUUID();
	// A token is minted so the column is never null; it is not shown anywhere.
	// The profile's "reveal" action regenerates it (see Task 10).
	db.insert(users)
		.values({ id, displayName, isAdmin, loginTokenHash: hashToken(generateToken()) })
		.run();
	return { id, displayName, isAdmin };
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

export function validateDisplayName(raw: FormDataEntryValue | null): string | null {
	const name = String(raw ?? '').trim();
	if (!name || name.length > DISPLAY_NAME_MAX) return null;
	return name;
}
