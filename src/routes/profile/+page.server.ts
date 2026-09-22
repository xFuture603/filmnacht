import { db } from '$lib/server/db';
import { listGroupsFor } from '$lib/server/groups';
import { regenerateLoginToken } from '$lib/server/users';
import { error } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = ({ locals }) => {
	if (!locals.user) error(401, 'Sign in first');
	return { groups: listGroupsFor(db, locals.user.id) };
};

export const actions: Actions = {
	reveal: async ({ locals, url }) => {
		if (!locals.user) error(401, 'Sign in first');
		// Only the hash is stored (PRD §10), so the link cannot be shown again —
		// revealing mints a fresh one, which is also the "revoke" of PRD §9.
		const token = regenerateLoginToken(db, locals.user.id);
		return { loginUrl: `${url.origin}/login/${token}` };
	}
};
