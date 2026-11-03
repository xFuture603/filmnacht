import { db } from '$lib/server/db';
import { requireMember, requireUser } from '$lib/server/groups';
import { notifyNightScheduled } from '$lib/server/night-mail';
import { LOCATION_MAX, lastLocationOf, listNights, scheduleNight } from '$lib/server/nights';
import { parseTime, scheduleDefaults, todayIn } from '$lib/schedule';
import { getTimezone } from '$lib/server/settings';
import { wallTimeToUtc } from '$lib/time';
import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = ({ locals, params }) => {
	const user = requireUser(locals);
	const group = requireMember(db, user.id, params.groupId);
	const timezone = getTimezone(db);
	const now = new Date();
	const latest = listNights(db, params.groupId)[0] ?? null;
	// The latest night is the best guess for the next one's weekday and time.
	// The place is the viewer's own last one: whoever plans it may host it elsewhere.
	const defaults = {
		...scheduleDefaults(latest, timezone, now),
		location: lastLocationOf(db, params.groupId, user.id)
	};
	return {
		group,
		locationMax: LOCATION_MAX,
		defaults,
		// The date field's earliest day: the instance's today, not the device's.
		today: todayIn(now, timezone)
	};
};

export const actions: Actions = {
	schedule: async ({ request, locals, params }) => {
		const user = requireUser(locals);
		requireMember(db, user.id, params.groupId);
		const form = await request.formData();
		// Nothing below awaits: the checks and the insert run as one step.
		const field = (name: string) => String(form.get(name) ?? '').trim();
		const picked = { day: field('day'), time: field('time') };
		const location = field('location');
		const echo = { ...picked, location };

		// The calendar and the slots carry no zone. They mean the instance's wall
		// clock, not the server's and not the browser's.
		if (!picked.day) return fail(400, { error: 'nights.error.day', ...echo });
		// Typed on a computer, so "19.45" and "1945" count as well as "19:45".
		const time = parseTime(picked.time);
		if (!time) return fail(400, { error: 'nights.error.time', ...echo });
		const scheduledAt = wallTimeToUtc(`${picked.day}T${time}`, getTimezone(db));
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
		notifyNightScheduled(db, id);
		redirect(303, `/groups/${params.groupId}/nights/${id}`);
	}
};
