import { error } from '@sveltejs/kit';
import { and, eq, isNull } from 'drizzle-orm';
import type { DB } from './db/client';
import { groups, memberships, users, type GroupSettings } from './db/schema';

export type GroupMembership = {
	groupId: string;
	name: string;
	emoji: string | null;
	settings: GroupSettings;
	role: 'owner' | 'member';
};

export function createGroup(
	db: DB,
	input: { name: string; emoji?: string | null; ownerId: string }
): string {
	const id = crypto.randomUUID();
	db.transaction((tx) => {
		tx.insert(groups)
			.values({ id, name: input.name, emoji: input.emoji ?? null, ownerId: input.ownerId })
			.run();
		tx.insert(memberships).values({ userId: input.ownerId, groupId: id, role: 'owner' }).run();
	});
	return id;
}

/**
 * The only way a route should reach group data. A non-member and a non-existent
 * group produce the identical 404, so a guessed id reveals nothing (PRD §12).
 */
export function requireMember(db: DB, userId: string, groupId: string): GroupMembership {
	const row = db
		.select({
			groupId: groups.id,
			name: groups.name,
			emoji: groups.emoji,
			settings: groups.settings,
			role: memberships.role
		})
		.from(memberships)
		.innerJoin(groups, eq(groups.id, memberships.groupId))
		.where(
			and(
				eq(memberships.groupId, groupId),
				eq(memberships.userId, userId),
				isNull(memberships.leftAt)
			)
		)
		.get();
	// 'Not found' here is a developer-facing label (logs, error object), never
	// shown to a user — the app's +error.svelte renders the translated message.
	// Do not thread `locale` through this function to translate it here: it
	// would pollute the core authorization primitive's signature for the sake
	// of a string, and the 404 body must stay identical for "not a member" and
	// "no such group" in every language anyway — that indistinguishability is
	// the whole point of 404-not-403.
	if (!row) error(404, 'Not found');
	return row;
}

export function addMember(db: DB, userId: string, groupId: string): void {
	db.insert(memberships)
		.values({ userId, groupId, role: 'member' })
		.onConflictDoUpdate({
			target: [memberships.userId, memberships.groupId],
			set: { leftAt: null }
		})
		.run();
}

/** Access goes, history stays — name included (PRD §4). */
export function leaveGroup(db: DB, userId: string, groupId: string): void {
	db.update(memberships)
		.set({ leftAt: new Date() })
		.where(and(eq(memberships.userId, userId), eq(memberships.groupId, groupId)))
		.run();
}

export function listGroupsFor(db: DB, userId: string) {
	return db
		.select({
			id: groups.id,
			name: groups.name,
			emoji: groups.emoji,
			role: memberships.role
		})
		.from(memberships)
		.innerJoin(groups, eq(groups.id, memberships.groupId))
		.where(and(eq(memberships.userId, userId), isNull(memberships.leftAt)))
		.all();
}

export function listMembers(db: DB, groupId: string) {
	return db
		.select({ id: users.id, displayName: users.displayName, role: memberships.role })
		.from(memberships)
		.innerJoin(users, eq(users.id, memberships.userId))
		.where(and(eq(memberships.groupId, groupId), isNull(memberships.leftAt)))
		.all();
}
