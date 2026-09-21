import type { Cookies } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import type { DB } from '../db/client';
import { sessions, users } from '../db/schema';
import { generateToken, hashToken } from './tokens';

export const SESSION_COOKIE = 'filmnacht_session';
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export type SessionUser = { id: string; displayName: string; isAdmin: boolean };

export function createSession(db: DB, userId: string, now = Date.now()) {
	const token = generateToken();
	const expiresAt = new Date(now + SESSION_TTL_MS);
	db.insert(sessions)
		.values({ id: hashToken(token), userId, expiresAt })
		.run();
	return { token, expiresAt };
}

export function validateSession(db: DB, token: string, now = Date.now()) {
	const id = hashToken(token);
	const row = db
		.select({
			expiresAt: sessions.expiresAt,
			id: users.id,
			displayName: users.displayName,
			isAdmin: users.isAdmin
		})
		.from(sessions)
		.innerJoin(users, eq(users.id, sessions.userId))
		.where(eq(sessions.id, id))
		.get();
	if (!row) return null;

	if (row.expiresAt.getTime() <= now) {
		db.delete(sessions).where(eq(sessions.id, id)).run();
		return null;
	}

	// Sliding expiry: extend once past the halfway point, so an active user is
	// never logged out but an idle one still ages out after 30 days.
	let expiresAt = row.expiresAt;
	let refreshed = false;
	if (expiresAt.getTime() - now < SESSION_TTL_MS / 2) {
		expiresAt = new Date(now + SESSION_TTL_MS);
		db.update(sessions).set({ expiresAt }).where(eq(sessions.id, id)).run();
		refreshed = true;
	}

	const user: SessionUser = {
		id: row.id,
		displayName: row.displayName,
		isAdmin: row.isAdmin
	};
	return { user, expiresAt, refreshed };
}

export function deleteSession(db: DB, token: string): void {
	db.delete(sessions)
		.where(eq(sessions.id, hashToken(token)))
		.run();
}

export function setSessionCookie(
	cookies: Cookies,
	token: string,
	expiresAt: Date,
	secure: boolean
): void {
	cookies.set(SESSION_COOKIE, token, {
		path: '/',
		httpOnly: true,
		sameSite: 'lax',
		secure,
		expires: expiresAt
	});
}

export function clearSessionCookie(cookies: Cookies): void {
	cookies.delete(SESSION_COOKIE, { path: '/' });
}
