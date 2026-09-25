import { eq } from 'drizzle-orm';
import { randomBytes } from 'node:crypto';
import { hashToken } from './auth/tokens';
import type { DB } from './db/client';
import { ratings, suggestions, users } from './db/schema';

/**
 * Reserved. `validateUsername` (src/lib/server/users.ts) rejects this exact
 * value after its own normalisation, so nothing created through join or setup
 * can ever claim it — the row this module creates is the only account that
 * will ever hold this username.
 */
export const FORMER_MEMBER_USERNAME = 'former-member';

/**
 * Finds or creates the placeholder that owns a departed member's rows.
 *
 * It is a real `users` row rather than a NULL because NULL already means
 * wildcard (PRD §6) — a film belonging to nobody that counts toward no
 * member's fairness window. Folding "this person left" into that meaning would
 * quietly drop their films out of the group's history.
 */
export function formerMemberId(db: DB): string {
	const existing = db
		.select({ id: users.id })
		.from(users)
		.where(eq(users.username, FORMER_MEMBER_USERNAME))
		.get();
	if (existing) return existing.id;

	const id = crypto.randomUUID();
	db.insert(users)
		.values({
			id,
			username: FORMER_MEMBER_USERNAME,
			displayName: 'Former member',
			// Not a hash of anything: `scrypt$…` is the only format verifyPassword
			// accepts, and a random 64-byte value in the wrong shape can never match
			// any input. This row must never be signable-in.
			passwordHash: `unusable$${randomBytes(32).toString('base64url')}`,
			loginTokenHash: hashToken(randomBytes(32).toString('base64url')),
			isAdmin: false
		})
		.run();
	return id;
}

/**
 * Repoints a member's suggestions AND ratings at the placeholder. Call this
 * BEFORE deleting an account: both foreign keys are `restrict`, so a delete that
 * skips this step fails loudly instead of corrupting attribution.
 */
export function reassignToFormerMember(
	db: DB,
	userId: string
): { suggestions: number; ratings: number } {
	const placeholder = formerMemberId(db);
	return db.transaction(() => ({
		suggestions: db
			.update(suggestions)
			.set({ suggestedBy: placeholder })
			.where(eq(suggestions.suggestedBy, userId))
			.run().changes,
		ratings: db.update(ratings).set({ userId: placeholder }).where(eq(ratings.userId, userId)).run()
			.changes
	}));
}
