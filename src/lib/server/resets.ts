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
 * Retires every outstanding reset for an account without consuming one, and
 * returns how many died.
 *
 * Called when the account's password changes by any other route. A reset link
 * that outlives the password it was issued to reset can still overwrite the one
 * its owner just chose — and the moment someone changes their password is
 * exactly the moment a reset may have been requested on their account by
 * somebody else. Same shape as the defect Plan 3 shipped, one credential
 * further out: a revocation path that revokes all but one of the ways in.
 */
export function retireResets(db: DB, userId: string, now = Date.now()): number {
	return db
		.update(passwordResets)
		.set({ usedAt: new Date(now) })
		.where(and(eq(passwordResets.userId, userId), isNull(passwordResets.usedAt)))
		.run().changes;
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
		// second live for the rest of the hour.
		retireResets(db, row.userId, now);
		return row.userId;
	});
}
