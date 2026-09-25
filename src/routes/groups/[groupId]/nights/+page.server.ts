import { db } from '$lib/server/db';
import { requireMember, requireOwner, requireUser } from '$lib/server/groups';
import { LOCATION_MAX, listNights, scheduleNight } from '$lib/server/nights';
import { averagesFor } from '$lib/server/ratings';
import { getTimezone } from '$lib/server/settings';
import { formatWhen, wallTimeToUtc } from '$lib/server/time';
import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = ({ locals, params }) => {
	const user = requireUser(locals);
	// Membership before anything about the group's nights is read (PRD §12).
	const group = requireMember(db, user.id, params.groupId);
	const timezone = getTimezone(db);
	const now = Date.now();
	const averages = averagesFor(db, params.groupId, group.settings, new Date());
	// listNights is latest-first; what is coming reads better soonest-first.
	const nights = listNights(db, params.groupId).map((night) => ({
		...night,
		when: formatWhen(night.scheduledAt, timezone, locals.locale),
		average: averages.get(night.id) ?? null
	}));
	return {
		group,
		isOwner: group.role === 'owner',
		upcoming: nights.filter((n) => n.scheduledAt.getTime() >= now).reverse(),
		past: nights.filter((n) => n.scheduledAt.getTime() < now),
		locationMax: LOCATION_MAX,
		timezone
	};
};

export const actions: Actions = {
	schedule: async ({ request, locals, params }) => {
		const user = requireUser(locals);
		requireOwner(db, user.id, params.groupId);
		const form = await request.formData();
		// Nothing below awaits: the checks and the insert run as one step.
		const when = String(form.get('when') ?? '');
		const location = String(form.get('location') ?? '').trim();

		// A datetime-local value has no zone. It means the instance's wall clock,
		// not the server's and not the browser's (PRD §6, §12).
		const scheduledAt = wallTimeToUtc(when, getTimezone(db));
		if (!scheduledAt) return fail(400, { error: 'nights.error.when', when, location });
		if (scheduledAt.getTime() < Date.now()) {
			return fail(400, { error: 'nights.error.past', when, location });
		}
		if (location.length > LOCATION_MAX) {
			return fail(400, { error: 'nights.error.location', when, location });
		}

		const id = scheduleNight(db, {
			groupId: params.groupId,
			userId: user.id,
			scheduledAt,
			location: location || null
		});
		redirect(303, `/groups/${params.groupId}/nights/${id}`);
	}
};
