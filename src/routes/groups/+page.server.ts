import { db } from '$lib/server/db';
import { createGroup, listGroupsFor, requireUser } from '$lib/server/groups';
import { newCounts } from '$lib/server/seen';
import { validateDisplayName } from '$lib/server/users';
import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = ({ locals }) => {
	const user = requireUser(locals);
	// One newCounts per group: a member is in a handful of groups, not hundreds.
	const groups = listGroupsFor(db, user.id).map((group) => {
		const counts = newCounts(db, user.id, group.id);
		return { ...group, newCount: counts.pool + counts.nights };
	});
	return { groups };
};

export const actions: Actions = {
	create: async ({ request, locals }) => {
		const user = requireUser(locals);
		const form = await request.formData();
		// Same rule as a display name: non-empty, trimmed, max 60.
		const name = validateDisplayName(form.get('name'));
		if (!name) return fail(400, { error: 'groups.error.name' });
		const id = createGroup(db, { name, ownerId: user.id });
		redirect(303, `/groups/${id}`);
	}
};
