import { and, eq, inArray, isNull } from 'drizzle-orm';
import type { DB } from './db/client';
import { groups, memberships, movieNights, movies, ratings, suggestions, users } from './db/schema';
import { groupSettings } from './group-settings';
import { ratingWindow } from './ratings';

/**
 * "Rating is open" and "closes tomorrow" emails (rating-reminders spec). Each
 * goes out at most once per night: a tick claims it with a test-and-set update
 * on the night before sending anything, so a restart or a second tick finds it
 * taken. Who gets it is decided at send time.
 */

export type RatingMailKind = 'open' | 'reminder';
export type DueRatingMail = { nightId: string; kind: RatingMailKind; lastDay: boolean };

const DAY = 24 * 60 * 60 * 1000;

export function dueRatingMails(db: DB, now: Date): DueRatingMail[] {
	const nights = db
		.select({
			id: movieNights.id,
			status: movieNights.status,
			scheduledAt: movieNights.scheduledAt,
			watchedAt: movieNights.watchedAt,
			openMailedAt: movieNights.ratingOpenMailedAt,
			reminderMailedAt: movieNights.ratingReminderMailedAt,
			settings: groups.settings
		})
		.from(movieNights)
		.innerJoin(groups, eq(groups.id, movieNights.groupId))
		.where(inArray(movieNights.status, ['drawn', 'watched']))
		.all();

	const due: DueRatingMail[] = [];
	for (const n of nights) {
		const window = ratingWindow(n, groupSettings(n.settings), now);
		if (window.state !== 'open') continue;
		const lastDay = window.closesAt.getTime() - now.getTime() <= DAY;
		if (!n.openMailedAt) {
			due.push({ nightId: n.id, kind: 'open', lastDay });
		} else if (!n.reminderMailedAt && lastDay && now.getTime() - n.openMailedAt.getTime() >= DAY) {
			due.push({ nightId: n.id, kind: 'reminder', lastDay });
		}
	}
	return due;
}

/** True only for the caller that took it: the email is theirs to send. */
export function claimRatingMail(db: DB, due: DueRatingMail, now: Date): boolean {
	if (due.kind === 'reminder') {
		return (
			db
				.update(movieNights)
				.set({ ratingReminderMailedAt: now })
				.where(and(eq(movieNights.id, due.nightId), isNull(movieNights.ratingReminderMailedAt)))
				.run().changes > 0
		);
	}
	// Opening with under a day left: one email, not "open" and "closes" back to back.
	return (
		db
			.update(movieNights)
			.set(
				due.lastDay
					? { ratingOpenMailedAt: now, ratingReminderMailedAt: now }
					: { ratingOpenMailedAt: now }
			)
			.where(and(eq(movieNights.id, due.nightId), isNull(movieNights.ratingOpenMailedAt)))
			.run().changes > 0
	);
}

export function ratingRecipients(db: DB, nightId: string): string[] {
	const night = db
		.select({ groupId: movieNights.groupId })
		.from(movieNights)
		.where(eq(movieNights.id, nightId))
		.get();
	if (!night) return [];
	const rated = new Set(
		db
			.select({ userId: ratings.userId })
			.from(ratings)
			.where(eq(ratings.movieNightId, nightId))
			.all()
			.map((r) => r.userId)
	);
	return db
		.select({ id: users.id, email: users.email, ratingMails: users.ratingMails })
		.from(memberships)
		.innerJoin(users, eq(users.id, memberships.userId))
		.where(and(eq(memberships.groupId, night.groupId), isNull(memberships.leftAt)))
		.all()
		.filter((u) => u.ratingMails && !rated.has(u.id))
		.map((u) => u.email)
		.filter((email): email is string => email !== null);
}

export function ratingMailInfo(
	db: DB,
	nightId: string,
	now: Date
): { groupId: string; groupName: string; title: string; closesAt: Date } | null {
	const row = db
		.select({
			groupId: movieNights.groupId,
			groupName: groups.name,
			settings: groups.settings,
			status: movieNights.status,
			scheduledAt: movieNights.scheduledAt,
			watchedAt: movieNights.watchedAt,
			title: movies.title
		})
		.from(movieNights)
		.innerJoin(groups, eq(groups.id, movieNights.groupId))
		.leftJoin(suggestions, eq(suggestions.id, movieNights.suggestionId))
		.leftJoin(movies, eq(movies.id, suggestions.movieId))
		.where(eq(movieNights.id, nightId))
		.get();
	if (!row || !row.title) return null;
	const window = ratingWindow(row, groupSettings(row.settings), now);
	if (window.state !== 'open') return null;
	return {
		groupId: row.groupId,
		groupName: row.groupName,
		title: row.title,
		closesAt: window.closesAt
	};
}
