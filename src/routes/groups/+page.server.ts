import { db } from '$lib/server/db';
import { createGroup, listGroupsFor } from '$lib/server/groups';
import { validateDisplayName } from '$lib/server/users';
import { error, fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = ({ locals }) => {
	if (!locals.user) error(401, 'Sign in first');
	return { groups: listGroupsFor(db, locals.user.id) };
};

export const actions: Actions = {
	create: async ({ request, locals }) => {
		if (!locals.user) error(401, 'Sign in first');
		const form = await request.formData();
		// Same rule as a display name: non-empty, trimmed, max 60.
		const name = validateDisplayName(form.get('name'));
		if (!name) return fail(400, { error: 'groups.error.name' });
		const emoji =
			String(form.get('emoji') ?? '')
				.trim()
				.slice(0, 8) || null;
		const id = createGroup(db, { name, emoji, ownerId: locals.user.id });
		redirect(303, `/groups/${id}`);
	}
};
