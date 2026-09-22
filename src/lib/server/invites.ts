import { and, eq, gt, isNull, or, sql } from 'drizzle-orm';
import { generateToken, hashToken } from './auth/tokens';
import type { DB } from './db/client';
import { groups, invites, memberships } from './db/schema';
import { addMember } from './groups';

export const INVITE_TTL_DAYS = 7;

/**
 * Default cap on redemptions per invite link. PRD §1 sizes a group at 3-12
 * people, so this never realistically blocks a legitimate invite — but it
 * bounds the damage of a leaked link, which would otherwise create accounts
 * without limit for its full 7 days. Pass `maxUses: null` for an uncapped one.
 */
export const INVITE_MAX_USES = 12;

export function createInvite(
	db: DB,
	input: { groupId: string; createdBy: string; maxUses?: number | null; now?: number }
): string {
	const now = input.now ?? Date.now();
	const token = generateToken();
	db.insert(invites)
		.values({
			tokenHash: hashToken(token),
			groupId: input.groupId,
			createdBy: input.createdBy,
			maxUses: input.maxUses === undefined ? INVITE_MAX_USES : input.maxUses,
			expiresAt: new Date(now + INVITE_TTL_DAYS * 24 * 60 * 60 * 1000)
		})
		.run();
	return token;
}

/** Live means: the hash matches, it has not expired, and the cap is not reached. */
export function lookupInvite(db: DB, token: string, now = Date.now()) {
	const row = db
		.select({
			groupId: groups.id,
			groupName: groups.name,
			groupEmoji: groups.emoji
		})
		.from(invites)
		.innerJoin(groups, eq(groups.id, invites.groupId))
		.where(
			and(
				eq(invites.tokenHash, hashToken(token)),
				gt(invites.expiresAt, new Date(now)),
				or(isNull(invites.maxUses), sql`${invites.uses} < ${invites.maxUses}`)
			)
		)
		.get();
	return row ?? null;
}

export function redeemInvite(
	db: DB,
	token: string,
	userId: string,
	now = Date.now()
): string | null {
	const invite = lookupInvite(db, token, now);
	if (!invite) return null;

	return db.transaction(() => {
		// Opening the same link twice must not burn a redemption from the cap.
		const existing = db
			.select({ userId: memberships.userId })
			.from(memberships)
			.where(
				and(
					eq(memberships.groupId, invite.groupId),
					eq(memberships.userId, userId),
					isNull(memberships.leftAt)
				)
			)
			.get();
		if (existing) return invite.groupId;

		// `db`, not a `tx` handle, is correct here: better-sqlite3 is a single
		// connection, so BEGIN applies to every statement issued through `db`
		// until COMMIT (see setup.ts). addMember is reused rather than inlining
		// a second copy of its upsert logic.
		addMember(db, userId, invite.groupId);
		db.update(invites)
			.set({ uses: sql`${invites.uses} + 1` })
			.where(eq(invites.tokenHash, hashToken(token)))
			.run();
		return invite.groupId;
	});
}
