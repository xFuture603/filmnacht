import { db } from '$lib/server/db';
import { requireMember, requireOwner, requireUser } from '$lib/server/groups';
import { notifyNightScheduled } from '$lib/server/night-mail';
import { LOCATION_MAX, listNights, scheduleNight } from '$lib/server/nights';
import { averagesFor } from '$lib/server/ratings';
import { visit } from '$lib/server/seen';
import { scheduleDefaults, todayIn } from '$lib/schedule';
import { getTimezone } from '$lib/server/settings';
import { formatWhen, wallTimeToUtc } from '$lib/time';
import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = ({ locals, params, url }) => {
	const user = requireUser(locals);
	// Membership before anything about the group's nights is read (PRD §12).
	const group = requireMember(db, user.id, params.groupId);
	const { newIds, counts } = visit(db, user.id, params.groupId, 'nights');
	const timezone = getTimezone(db);
	const now = Date.now();
	const averages = averagesFor(db, params.groupId, group.settings, new Date());
	// listNights is latest-first; what is coming reads better soonest-first.
	const all = listNights(db, params.groupId);
	// The latest night is the best guess for the next one: same weekday, time, place.
	const defaults = scheduleDefaults(all[0] ?? null, timezone, new Date(now));
	const today = todayIn(new Date(now), timezone);
	const requested = /^\d{4}-(0[1-9]|1[0-2])$/.test(url.searchParams.get('month') ?? '')
		? url.searchParams.get('month')
		: null;
	const nights = all.map((night) => ({
		...night,
		when: formatWhen(night.scheduledAt, timezone, locals.locale),
		average: averages.get(night.id) ?? null,
		isNew: newIds.has(night.id)
	}));
	return {
		group,
		isOwner: group.role === 'owner',
		newCounts: counts,
		upcoming: nights.filter((n) => n.scheduledAt.getTime() >= now).reverse(),
		past: nights.filter((n) => n.scheduledAt.getTime() < now),
		locationMax: LOCATION_MAX,
		timezone,
		defaults,
		today,
		// The calendar opens on ?month= (so ‹ › work without JavaScript), else on
		// the suggested day's month; never on a month that is already over.
		month:
			requested && requested >= today.slice(0, 7) ? requested : (defaults.day ?? today).slice(0, 7),
		// Only a group that has met has a usual time worth offering as a slot.
		usualTime: all[0] ? defaults.time : null
	};
};

export const actions: Actions = {
	schedule: async ({ request, locals, params }) => {
		const user = requireUser(locals);
		requireOwner(db, user.id, params.groupId);
		const form = await request.formData();
		// Nothing below awaits: the checks and the insert run as one step.
		const field = (name: string) => String(form.get(name) ?? '').trim();
		const picked = { day: field('day'), time: field('time') };
		const location = field('location');
		const echo = { ...picked, location };

		// The calendar and the slots carry no zone. They mean the instance's wall
		// clock, not the server's and not the browser's (PRD §6, §12).
		if (!picked.day) return fail(400, { error: 'nights.error.day', ...echo });
		const scheduledAt = wallTimeToUtc(`${picked.day}T${picked.time}`, getTimezone(db));
		if (!scheduledAt) return fail(400, { error: 'nights.error.when', ...echo });
		if (scheduledAt.getTime() < Date.now()) {
			return fail(400, { error: 'nights.error.past', ...echo });
		}
		if (location.length > LOCATION_MAX) {
			return fail(400, { error: 'nights.error.location', ...echo });
		}

		const id = scheduleNight(db, {
			groupId: params.groupId,
			userId: user.id,
			scheduledAt,
			location: location || null
		});
		notifyNightScheduled(db, id, user.id);
		redirect(303, `/groups/${params.groupId}/nights/${id}`);
	}
};
