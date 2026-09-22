import { db } from '$lib/server/db';
import { createGroup, listGroupsFor, requireUser } from '$lib/server/groups';
import { validateDisplayName } from '$lib/server/users';
import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = ({ locals }) => {
	const user = requireUser(locals);
	return { groups: listGroupsFor(db, user.id) };
};

export const actions: Actions = {
	create: async ({ request, locals }) => {
		const user = requireUser(locals);
		const form = await request.formData();
		// Same rule as a display name: non-empty, trimmed, max 60.
		const name = validateDisplayName(form.get('name'));
		if (!name) return fail(400, { error: 'groups.error.name' });
		const emoji =
			String(form.get('emoji') ?? '')
				.trim()
				.slice(0, 8) || null;
		const id = createGroup(db, { name, emoji, ownerId: user.id });
		redirect(303, `/groups/${id}`);
	}
};
