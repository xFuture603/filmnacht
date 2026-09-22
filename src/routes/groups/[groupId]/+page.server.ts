import { db } from '$lib/server/db';
import { listMembers, requireMember } from '$lib/server/groups';
import { createInvite } from '$lib/server/invites';
import { error } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = ({ locals, params }) => {
	if (!locals.user) error(401, 'Sign in first');
	const group = requireMember(db, locals.user.id, params.groupId);
	return { group, members: listMembers(db, params.groupId) };
};

export const actions: Actions = {
	invite: async ({ locals, params, url }) => {
		if (!locals.user) error(401, 'Sign in first');
		const membership = requireMember(db, locals.user.id, params.groupId);
		if (membership.role !== 'owner') error(403, 'Only the owner can invite');
		const token = createInvite(db, { groupId: params.groupId, createdBy: locals.user.id });
		// Returned once and never stored in the clear — the row holds only the hash.
		return { inviteUrl: `${url.origin}/join/${token}` };
	}
};
