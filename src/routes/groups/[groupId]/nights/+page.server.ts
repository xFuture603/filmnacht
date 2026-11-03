import { db } from '$lib/server/db';
import { requireMember, requireUser } from '$lib/server/groups';
import { isResultVisible, listNights } from '$lib/server/nights';
import { averagesFor } from '$lib/server/ratings';
import { visit } from '$lib/server/seen';
import { getTimezone } from '$lib/server/settings';
import { formatHistoryDay, formatShortWhen } from '$lib/time';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = ({ locals, params }) => {
	const user = requireUser(locals);
	// Membership before anything about the group's nights is read.
	const group = requireMember(db, user.id, params.groupId);
	const { newIds, counts } = visit(db, user.id, params.groupId, 'nights');
	const timezone = getTimezone(db);
	const now = new Date();
	const averages = averagesFor(db, params.groupId, group.settings, now);
	// A cancelled night never happened: it is not part of the group's list.
	// Its own page stays reachable for the cancellation email.
	const nights = listNights(db, params.groupId)
		.filter((night) => night.status !== 'cancelled')
		.map(({ title, posterUrl, ...night }) => {
			// Withheld from the payload while the group keeps it a surprise.
			const visible = isResultVisible(group.settings, night, now);
			return {
				...night,
				film: title && visible ? { title, posterUrl } : null,
				filmHidden: title !== null && !visible,
				average: averages.get(night.id) ?? null,
				isNew: newIds.has(night.id)
			};
		});
	// A night marked watched early has happened, even if its date is still ahead.
	const isPast = (n: (typeof nights)[number]) =>
		n.status === 'watched' || n.scheduledAt.getTime() < now.getTime();
	return {
		group,
		isOwner: group.role === 'owner',
		newCounts: counts,
		// listNights is latest-first; what is coming reads better soonest-first.
		// Coming up is within weeks: day and time, no year. History needs the year, not the time.
		upcoming: nights
			.filter((n) => !isPast(n))
			.reverse()
			.map((n) => ({ ...n, when: formatShortWhen(n.scheduledAt, timezone, locals.locale) })),
		past: nights
			.filter(isPast)
			.map((n) => ({ ...n, when: formatHistoryDay(n.scheduledAt, timezone, locals.locale) }))
	};
};
