import { and, eq, gt, isNull, ne, or } from 'drizzle-orm';
import type { DB } from './db/client';
import { memberships, movieNights, suggestions } from './db/schema';

/**
 * "New since your last visit" for a group's Films and Nights tabs. Nothing is
 * sent anywhere (PRD decision 13): the state is two timestamps per membership,
 * and opening a tab moves its timestamp to now.
 */

export type Tab = 'pool' | 'nights';
export type NewCounts = { pool: number; nights: number };

function membership(db: DB, userId: string, groupId: string) {
	const row = db
		.select({
			role: memberships.role,
			joinedAt: memberships.joinedAt,
			poolSeenAt: memberships.poolSeenAt,
			nightsSeenAt: memberships.nightsSeenAt
		})
		.from(memberships)
		.where(
			and(
				eq(memberships.userId, userId),
				eq(memberships.groupId, groupId),
				isNull(memberships.leftAt)
			)
		)
		.get();
	// Callers run requireMember first; reaching this is a bug, not a 404.
	if (!row) throw new Error('not a member');
	return row;
}

type Membership = ReturnType<typeof membership>;

function newIdsFor(db: DB, userId: string, groupId: string, m: Membership, tab: Tab): string[] {
	if (tab === 'pool') {
		return db
			.select({ id: suggestions.id })
			.from(suggestions)
			.where(
				and(
					eq(suggestions.groupId, groupId),
					// Drawn films are left out, so a count never gives away a surprise draw.
					eq(suggestions.status, 'open'),
					gt(suggestions.createdAt, m.poolSeenAt ?? m.joinedAt),
					// `!=` alone is NULL for a wildcard film, which would drop it.
					or(isNull(suggestions.suggestedBy), ne(suggestions.suggestedBy, userId))
				)
			)
			.all()
			.map((row) => row.id);
	}
	// Only the owner schedules nights, so none of them is news to the owner.
	if (m.role === 'owner') return [];
	return db
		.select({ id: movieNights.id })
		.from(movieNights)
		.where(
			and(
				eq(movieNights.groupId, groupId),
				ne(movieNights.status, 'cancelled'),
				gt(movieNights.createdAt, m.nightsSeenAt ?? m.joinedAt)
			)
		)
		.all()
		.map((row) => row.id);
}

export function newCounts(db: DB, userId: string, groupId: string): NewCounts {
	const m = membership(db, userId, groupId);
	return {
		pool: newIdsFor(db, userId, groupId, m, 'pool').length,
		nights: newIdsFor(db, userId, groupId, m, 'nights').length
	};
}

/**
 * Opening a tab: returns what is new against the old baseline (for the badges
 * on this visit), then moves that tab's baseline to `now`.
 */
export function visit(
	db: DB,
	userId: string,
	groupId: string,
	tab: Tab,
	now = new Date()
): { newIds: Set<string>; counts: NewCounts } {
	const newIds = new Set(newIdsFor(db, userId, groupId, membership(db, userId, groupId), tab));
	db.update(memberships)
		.set(tab === 'pool' ? { poolSeenAt: now } : { nightsSeenAt: now })
		.where(and(eq(memberships.userId, userId), eq(memberships.groupId, groupId)))
		.run();
	return { newIds, counts: newCounts(db, userId, groupId) };
}
