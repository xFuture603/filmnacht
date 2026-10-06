import { and, eq, inArray, isNull } from 'drizzle-orm';
import { t, type Locale } from '$lib/i18n';
import { formatWhen } from '$lib/time';
import type { DB } from './db/client';
import { groups, memberships, movieNights, movies, ratings, suggestions, users } from './db/schema';
import { groupSettings } from './group-settings';
import { isMailConfigured, sendMail } from './mail';
import { ratingWindow } from './ratings';
import { getEmailLocale, getTimezone } from './settings';

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

export function composeRatingMail(input: {
	locale: Locale;
	kind: RatingMailKind;
	groupName: string;
	title: string;
	closes: string;
	link: string | null;
	profileLink: string | null;
}): { subject: string; body: string } {
	const { locale, kind, groupName, title, closes, link, profileLink } = input;
	const lines = [t(locale, `mail.rating.${kind}.body`, { group: groupName, title, closes })];
	if (link) lines.push(t(locale, 'mail.rating.link', { link }));
	lines.push(
		profileLink
			? t(locale, 'mail.rating.opt_out_link', { link: profileLink })
			: t(locale, 'mail.rating.opt_out')
	);
	return {
		subject: t(locale, `mail.rating.${kind}.subject`, { title }),
		body: lines.join('\n\n')
	};
}

/**
 * One scheduler tick's worth of rating emails. Claims are synchronous; the
 * sends that follow are not awaited by the scheduler, only by tests.
 */
export function runRatingMails(
	db: DB,
	now: Date,
	origin: string | null,
	send: (to: string, subject: string, body: string) => Promise<boolean> | boolean = sendMail
): Promise<number> {
	// Without mail nothing is claimed: the emails go out once it is set up.
	if (!isMailConfigured()) return Promise.resolve(0);
	const locale = getEmailLocale(db);
	const timezone = getTimezone(db);
	const sends: Promise<boolean>[] = [];
	for (const due of dueRatingMails(db, now)) {
		if (!claimRatingMail(db, due, now)) continue;
		const info = ratingMailInfo(db, due.nightId, now);
		if (!info) continue;
		const { subject, body } = composeRatingMail({
			locale,
			kind: due.kind,
			groupName: info.groupName,
			title: info.title,
			closes: formatWhen(info.closesAt, timezone, locale),
			link: origin ? `${origin}/groups/${info.groupId}/nights/${due.nightId}` : null,
			profileLink: origin ? `${origin}/profile` : null
		});
		for (const to of ratingRecipients(db, due.nightId)) {
			// Each send isolated: a throwing one must not cost the rest their email.
			sends.push(
				Promise.resolve()
					.then(() => send(to, subject, body))
					.catch(() => false)
			);
		}
	}
	return Promise.all(sends).then((results) => {
		const failed = results.filter((ok) => !ok).length;
		if (failed > 0) console.error(`[filmnacht] rating mail: ${failed}/${results.length} failed`);
		return results.length;
	});
}
