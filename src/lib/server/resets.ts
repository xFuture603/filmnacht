import { and, eq, gt, isNull } from 'drizzle-orm';
import { generateToken, hashToken } from './auth/tokens';
import type { DB } from './db/client';
import { passwordResets } from './db/schema';

/**
 * One hour. Long enough to survive a slow mail server and someone reading their
 * inbox after dinner, short enough that a link forwarded or left open on a
 * shared screen stops being a credential the same evening.
 */
export const RESET_TTL_MS = 60 * 60 * 1000;

/** Returns the plaintext token. This is the only moment it exists. */
export function createReset(db: DB, userId: string, now = Date.now()): string {
	const token = generateToken();
	db.insert(passwordResets)
		.values({
			// No explicit id: the schema's uuid() helper already defaults it, and
			// nothing here needs the value back.
			tokenHash: hashToken(token),
			userId,
			expiresAt: new Date(now + RESET_TTL_MS)
		})
		.run();
	return token;
}

/**
 * Resolves the token and marks it used in one transaction, returning the user
 * id or null.
 *
 * There is deliberately no "check without consuming" variant. A caller that
 * looks first and acts second is the check-yield-act shape this codebase has
 * had to fix three times, and here it would let two tabs spend one token twice.
 */
export function consumeReset(db: DB, token: string, now = Date.now()): string | null {
	const tokenHash = hashToken(token);
	return db.transaction(() => {
		const row = db
			.select({ id: passwordResets.id, userId: passwordResets.userId })
			.from(passwordResets)
			.where(
				and(
					eq(passwordResets.tokenHash, tokenHash),
					isNull(passwordResets.usedAt),
					gt(passwordResets.expiresAt, new Date(now))
				)
			)
			.get();
		if (!row) return null;

		// Every outstanding token for this account, not just the one presented.
		// Requesting a reset twice and using the first link must not leave the
		// second live for the rest of the hour: the password is about to change,
		// and a credential that outlives the change it authorised is exactly the
		// shape that shipped once already here, when a password change rotated
		// the password and left the personal login link alive.
		db.update(passwordResets)
			.set({ usedAt: new Date(now) })
			.where(and(eq(passwordResets.userId, row.userId), isNull(passwordResets.usedAt)))
			.run();
		return row.userId;
	});
}
