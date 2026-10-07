import { env } from '$env/dynamic/private';
import { t, type Locale } from '$lib/i18n';
import { formatWhen } from '$lib/time';
import { and, eq, isNull, ne } from 'drizzle-orm';
import type { DB } from './db/client';
import { groups, memberships, movieNights, users } from './db/schema';
import { groupSettings } from './group-settings';
import { nightIcs } from './ics';
import { isMailConfigured, mailFromAddress, sendMail } from './mail';
import { getEmailLocale, getTimezone } from './settings';

/**
 * "Night scheduled" and "night cancelled" emails, each with a calendar file
 * (ics.ts). Sent right after the action, like the draw email; the owner who
 * acted gets none, and can use the night page's "Add to calendar" instead.
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

export function nightMailRecipients(db: DB, nightId: string, exceptUserId: string): string[] {
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
		.where(
			and(
				eq(memberships.groupId, night.groupId),
				isNull(memberships.leftAt),
				ne(users.id, exceptUserId)
			)
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
	byUserId: string,
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
	const sends = nightMailRecipients(db, nightId, byUserId).map((to) =>
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

function later(fn: () => Promise<unknown>) {
	if (!isMailConfigured()) return;
	setTimeout(() => {
		fn().catch(() => console.error('[filmnacht] night notification failed'));
	}, 0);
}

export function notifyNightScheduled(
	db: DB,
	nightId: string,
	byUserId: string,
	origin: string | null = env.ORIGIN ?? null
): void {
	later(() => sendNightMail(db, nightId, 'scheduled', byUserId, origin));
}

export function notifyNightCancelled(
	db: DB,
	nightId: string,
	byUserId: string,
	origin: string | null = env.ORIGIN ?? null
): void {
	later(() => sendNightMail(db, nightId, 'cancelled', byUserId, origin));
}
