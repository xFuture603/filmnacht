import { db } from '$lib/server/db';
import { listMembers, requireMember } from '$lib/server/groups';
import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = ({ locals, params }) => {
	if (!locals.user) error(401, 'Sign in first');
	const group = requireMember(db, locals.user.id, params.groupId);
	return { group, members: listMembers(db, params.groupId) };
};
