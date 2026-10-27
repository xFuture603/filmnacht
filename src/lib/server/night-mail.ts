import { env } from '$env/dynamic/private';
import { t, type Locale } from '$lib/i18n';
import { formatWhen } from '$lib/time';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import type { DB } from './db/client';
import { attendance, groups, memberships, movieNights, users } from './db/schema';
import { groupSettings } from './group-settings';
import { nightIcs } from './ics';
import { isMailConfigured, mailFromAddress, sendMail } from './mail';
import { getEmailLocale, getTimezone } from './settings';

/**
 * "Night scheduled" and "night cancelled" emails, each with a calendar file
 * (ics.ts). Sent right after the action, like the draw email, to every member
 * with an address, the owner who acted included: they want the entry too.
 */

export function nightMailInfo(db: DB, nightId: string) {
	const row = db
		.select({
			groupId: movieNights.groupId,
			groupName: groups.name,
			settings: groups.settings,
			status: movieNights.status,
			scheduledAt: movieNights.scheduledAt,
			location: movieNights.location
		})
		.from(movieNights)
		.innerJoin(groups, eq(groups.id, movieNights.groupId))
		.where(eq(movieNights.id, nightId))
		.get();
	if (!row) return null;
	const minutes = groupSettings(row.settings).nightEndsAfterMinutes;
	return {
		groupId: row.groupId,
		groupName: row.groupName,
		status: row.status,
		scheduledAt: row.scheduledAt,
		endsAt: new Date(row.scheduledAt.getTime() + minutes * 60_000),
		location: row.location
	};
}

export function nightMailRecipients(db: DB, nightId: string): string[] {
	const night = db
		.select({ groupId: movieNights.groupId })
		.from(movieNights)
		.where(eq(movieNights.id, nightId))
		.get();
	if (!night) return [];
	return db
		.select({ email: users.email, nightMails: users.nightMails })
		.from(memberships)
		.innerJoin(users, eq(users.id, memberships.userId))
		.where(and(eq(memberships.groupId, night.groupId), isNull(memberships.leftAt)))
		.all()
		.filter((u) => u.nightMails)
		.map((u) => u.email)
		.filter((email): email is string => email !== null);
}

const REMIND_BEFORE = 48 * 60 * 60 * 1000;

/**
 * Nights due their one "are you coming?" email: 2 days before, until the night
 * starts. A night scheduled less than 2 days ahead gets none, its invite only
 * just went out.
 */
export function dueRsvpReminders(db: DB, now: Date): string[] {
	return db
		.select({
			id: movieNights.id,
			scheduledAt: movieNights.scheduledAt,
			createdAt: movieNights.createdAt
		})
		.from(movieNights)
		.where(
			and(
				inArray(movieNights.status, ['scheduled', 'drawn']),
				isNull(movieNights.rsvpReminderMailedAt)
			)
		)
		.all()
		.filter((n) => {
			const remindAt = n.scheduledAt.getTime() - REMIND_BEFORE;
			return (
				n.createdAt.getTime() < remindAt &&
				now.getTime() >= remindAt &&
				now.getTime() < n.scheduledAt.getTime()
			);
		})
		.map((n) => n.id);
}

/** True only for the caller that took it: the email is theirs to send. */
export function claimRsvpReminder(db: DB, nightId: string, now: Date): boolean {
	return (
		db
			.update(movieNights)
			.set({ rsvpReminderMailedAt: now })
			.where(and(eq(movieNights.id, nightId), isNull(movieNights.rsvpReminderMailedAt)))
			.run().changes > 0
	);
}

/** Like nightMailRecipients, minus everyone who answered: yes, no and maybe alike. */
export function rsvpReminderRecipients(db: DB, nightId: string): string[] {
	const night = db
		.select({ groupId: movieNights.groupId })
		.from(movieNights)
		.where(eq(movieNights.id, nightId))
		.get();
	if (!night) return [];
	return db
		.select({ email: users.email, nightMails: users.nightMails })
		.from(memberships)
		.innerJoin(users, eq(users.id, memberships.userId))
		.leftJoin(
			attendance,
			and(eq(attendance.userId, users.id), eq(attendance.movieNightId, nightId))
		)
		.where(
			and(eq(memberships.groupId, night.groupId), isNull(memberships.leftAt), isNull(attendance.id))
		)
		.all()
		.filter((u) => u.nightMails)
		.map((u) => u.email)
		.filter((email): email is string => email !== null);
}

function composeNightMail(input: {
	locale: Locale;
	kind: 'scheduled' | 'cancelled';
	groupName: string;
	when: string;
	location: string | null;
	link: string | null;
	profileLink: string | null;
}): { subject: string; body: string } {
	const { locale, kind, groupName, when, location, link, profileLink } = input;
	const lines = [t(locale, `mail.night.${kind}.body`, { group: groupName, when })];
	if (kind === 'scheduled' && location) lines.push(t(locale, 'mail.night.where', { location }));
	if (kind === 'scheduled' && link) lines.push(t(locale, 'mail.night.link', { link }));
	lines.push(
		t(locale, kind === 'scheduled' ? 'mail.night.calendar' : 'mail.night.calendar_cancel')
	);
	lines.push(
		profileLink
			? t(locale, 'mail.night.opt_out_link', { link: profileLink })
			: t(locale, 'mail.night.opt_out')
	);
	return {
		subject: t(locale, `mail.night.${kind}.subject`, { group: groupName, when }),
		body: lines.join('\n\n')
	};
}

/** Composes and sends; resolves with the number of sends attempted. Tests await this. */
export function sendNightMail(
	db: DB,
	nightId: string,
	kind: 'scheduled' | 'cancelled',
	origin: string | null,
	send: typeof sendMail = sendMail
): Promise<number> {
	if (!isMailConfigured()) return Promise.resolve(0);
	const info = nightMailInfo(db, nightId);
	if (!info) return Promise.resolve(0);
	const locale = getEmailLocale(db);
	const link = origin ? `${origin}/groups/${info.groupId}/nights/${nightId}` : null;
	const { subject, body } = composeNightMail({
		locale,
		kind,
		groupName: info.groupName,
		when: formatWhen(info.scheduledAt, getTimezone(db), locale),
		location: info.location,
		link,
		profileLink: origin ? `${origin}/profile` : null
	});
	const method = kind === 'scheduled' ? 'REQUEST' : 'CANCEL';
	const organizer = mailFromAddress();
	// One copy per recipient: each names its own attendee, as iTIP expects.
	const contentFor = (attendee: string) =>
		nightIcs({
			nightId,
			method,
			groupName: info.groupName,
			start: info.scheduledAt,
			end: info.endsAt,
			location: info.location,
			url: link,
			organizer,
			attendee
		});
	const sends = nightMailRecipients(db, nightId).map((to) =>
		// Each send isolated: a throwing one must not cost the rest their email.
		Promise.resolve()
			.then(() => send(to, subject, body, { method, content: contentFor(to) }))
			.catch(() => false)
	);
	return Promise.all(sends).then((results) => {
		const failed = results.filter((ok) => !ok).length;
		if (failed > 0) console.error(`[filmnacht] night mail: ${failed}/${results.length} failed`);
		return results.length;
	});
}

/**
 * One scheduler tick's worth of "are you coming?" emails. No calendar file:
 * they have the invite already, and a second REQUEST duplicates the entry in
 * some clients. Claims are synchronous; sends are awaited only by tests.
 */
export function runRsvpReminders(
	db: DB,
	now: Date,
	origin: string | null,
	send: (to: string, subject: string, body: string) => Promise<boolean> | boolean = sendMail
): Promise<number> {
	// Without mail nothing is claimed: the reminder goes out once it is set up.
	if (!isMailConfigured()) return Promise.resolve(0);
	const locale = getEmailLocale(db);
	const timezone = getTimezone(db);
	const sends: Promise<boolean>[] = [];
	for (const nightId of dueRsvpReminders(db, now)) {
		if (!claimRsvpReminder(db, nightId, now)) continue;
		const info = nightMailInfo(db, nightId);
		if (!info) continue;
		const vars = { group: info.groupName, when: formatWhen(info.scheduledAt, timezone, locale) };
		const lines = [t(locale, 'mail.night.reminder.body', vars)];
		if (info.location) lines.push(t(locale, 'mail.night.where', { location: info.location }));
		if (origin) {
			const link = `${origin}/groups/${info.groupId}/nights/${nightId}`;
			lines.push(t(locale, 'mail.night.reminder.link', { link }));
		}
		lines.push(
			origin
				? t(locale, 'mail.night.opt_out_link', { link: `${origin}/profile` })
				: t(locale, 'mail.night.opt_out')
		);
		const subject = t(locale, 'mail.night.reminder.subject', vars);
		const body = lines.join('\n\n');
		for (const to of rsvpReminderRecipients(db, nightId)) {
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
		if (failed > 0) console.error(`[filmnacht] RSVP reminder: ${failed}/${results.length} failed`);
		return results.length;
	});
}

function later(fn: () => Promise<unknown>) {
	if (!isMailConfigured()) return;
	setTimeout(() => {
		fn().catch(() => console.error('[filmnacht] night notification failed'));
	}, 0);
}

export function notifyNightScheduled(
	db: DB,
	nightId: string,
	origin: string | null = env.ORIGIN ?? null
): void {
	later(() => sendNightMail(db, nightId, 'scheduled', origin));
}

export function notifyNightCancelled(
	db: DB,
	nightId: string,
	origin: string | null = env.ORIGIN ?? null
): void {
	later(() => sendNightMail(db, nightId, 'cancelled', origin));
}
