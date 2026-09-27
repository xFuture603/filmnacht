import { env } from '$env/dynamic/private';
import { t, type Locale } from '$lib/i18n';
import { formatWhen } from '$lib/time';
import { and, eq, isNull } from 'drizzle-orm';
import type { DB } from './db/client';
import { groups, memberships, movieNights, movies, suggestions, users } from './db/schema';
import type { DrawLogEntry } from './draw';
import { groupSettings } from './group-settings';
import { FORMER_MEMBER_USERNAME } from './members';
import { sendMail } from './mail';
import { getEmailLocale, getTimezone } from './settings';

/**
 * The "film was drawn" email (spec §3). Pure: every fact it needs — the
 * already-formatted `when`, whether this is a surprise night — is decided by
 * the caller, so this function has nothing left to get wrong about *whether*
 * to show the title. That decision lives in exactly one place: the `surprise`
 * branch below never reads `film` at all.
 */
export function composeDrawMail(input: {
	locale: Locale;
	groupName: string;
	when: string;
	location: string | null;
	film: { title: string; by: string | null; byFormer: boolean } | null;
	surprise: boolean;
	redrawn: { byName: string; reason: string } | null;
	link: string | null;
}): { subject: string; body: string } {
	const { locale, groupName, when, location, film, surprise, redrawn, link } = input;

	const lines = [t(locale, 'mail.draw.intro', { group: groupName, when })];
	if (location) lines.push(t(locale, 'mail.draw.where', { location }));

	if (surprise) {
		lines.push(t(locale, 'mail.draw.surprise'));
	} else if (film) {
		lines.push(
			film.byFormer
				? t(locale, 'mail.draw.film_former', { title: film.title })
				: t(locale, 'mail.draw.film', { title: film.title, by: film.by ?? '' })
		);
	}

	if (redrawn) {
		lines.push(t(locale, 'mail.draw.redrawn', { byName: redrawn.byName, reason: redrawn.reason }));
	}
	if (link) lines.push(t(locale, 'mail.draw.link', { link }));

	return {
		subject: t(locale, 'mail.draw.subject', { when }),
		body: lines.join('\n\n')
	};
}

/** Current members of the night's group who have an email address on file. */
export function drawRecipients(db: DB, nightId: string): string[] {
	const night = db
		.select({ groupId: movieNights.groupId })
		.from(movieNights)
		.where(eq(movieNights.id, nightId))
		.get();
	if (!night) return [];

	return db
		.select({ email: users.email })
		.from(memberships)
		.innerJoin(users, eq(users.id, memberships.userId))
		.where(and(eq(memberships.groupId, night.groupId), isNull(memberships.leftAt)))
		.all()
		.map((r) => r.email)
		.filter((email): email is string => email !== null);
}

/**
 * Everything `composeDrawMail` needs, read without a viewer — this runs on a
 * timer with no request behind it. Shaped like `nightDetail` (src/lib/server/
 * nights.ts) on purpose, minus the membership check and the fields the email
 * has no use for.
 */
function drawMailInfo(db: DB, nightId: string) {
	const row = db
		.select({
			groupId: movieNights.groupId,
			groupName: groups.name,
			groupSettings: groups.settings,
			scheduledAt: movieNights.scheduledAt,
			location: movieNights.location,
			drawnTitle: movies.title,
			drawnBy: users.displayName,
			drawnByUsername: users.username,
			drawLog: movieNights.drawLog
		})
		.from(movieNights)
		.innerJoin(groups, eq(groups.id, movieNights.groupId))
		.leftJoin(suggestions, eq(suggestions.id, movieNights.suggestionId))
		.leftJoin(movies, eq(movies.id, suggestions.movieId))
		.leftJoin(users, eq(users.id, suggestions.suggestedBy))
		.where(eq(movieNights.id, nightId))
		.get();
	if (!row) return null;

	const log = (row.drawLog as DrawLogEntry[] | null) ?? [];
	const redrawEntry = log.findLast((e) => e.reason);
	const redrawnBy = redrawEntry
		? db
				.select({ displayName: users.displayName })
				.from(users)
				.where(eq(users.id, redrawEntry.by ?? ''))
				.get()?.displayName
		: undefined;

	return {
		groupId: row.groupId,
		groupName: row.groupName,
		scheduledAt: row.scheduledAt,
		location: row.location,
		film: row.drawnTitle
			? {
					title: row.drawnTitle,
					by: row.drawnBy,
					byFormer: row.drawnByUsername === FORMER_MEMBER_USERNAME
				}
			: null,
		// Surprise is decided at send time, but every draw happens before the
		// night starts, so `on_night` is always still hidden here (spec §3).
		surprise: groupSettings(row.groupSettings).resultVisible === 'on_night',
		redrawn: redrawEntry?.reason ? { byName: redrawnBy ?? '', reason: redrawEntry.reason } : null
	};
}

/**
 * Fires after a draw commits (owner or automatic). Scheduled with
 * `setTimeout(…, 0)`, exactly like the reset email, so no draw ever waits on
 * SMTP. Never throws: a bad row, a query error or `sendMail` breaking its own
 * "never throws" contract all end up as one logged count, never an address or
 * a credential (Global Constraints).
 */
export function notifyDraw(
	db: DB,
	nightId: string,
	origin: string | null = env.ORIGIN ?? null
): void {
	setTimeout(() => {
		try {
			const info = drawMailInfo(db, nightId);
			if (!info) return;

			const locale = getEmailLocale(db);
			const when = formatWhen(info.scheduledAt, getTimezone(db), locale);
			const link = origin ? `${origin}/groups/${info.groupId}/nights/${nightId}` : null;
			const { subject, body } = composeDrawMail({
				locale,
				groupName: info.groupName,
				when,
				location: info.location,
				film: info.film,
				surprise: info.surprise,
				redrawn: info.redrawn,
				link
			});

			const recipients = drawRecipients(db, nightId);
			// Each send isolated: one throwing recipient (sendMail contractually
			// never does, but this must survive it anyway) must not cost the rest
			// their email, the same rule R2 applies to the scheduler's onDrawn.
			Promise.all(
				recipients.map((to) => {
					try {
						return Promise.resolve(sendMail(to, subject, body)).catch(() => false);
					} catch {
						return Promise.resolve(false);
					}
				})
			).then((results) => {
				const failed = results.filter((ok) => !ok).length;
				if (failed > 0) {
					console.error(`[filmnacht] draw mail: ${failed}/${results.length} failed to send`);
				}
			});
		} catch {
			console.error('[filmnacht] draw notification failed');
		}
	}, 0);
}
