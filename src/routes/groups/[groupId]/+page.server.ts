import { db } from '$lib/server/db';
import { listMembers, requireMember, requireOwner, requireUser } from '$lib/server/groups';
import { createInvite } from '$lib/server/invites';
import { rateLimit } from '$lib/server/rate-limit';
import { fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = ({ locals, params }) => {
	const user = requireUser(locals);
	const group = requireMember(db, user.id, params.groupId);
	return { group, members: listMembers(db, params.groupId) };
};

export const actions: Actions = {
	invite: async ({ locals, params, url }) => {
		const user = requireUser(locals);
		requireOwner(db, user.id, params.groupId);
		if (!rateLimit(`invite-create:${user.id}`, 20, 60_000)) {
			return fail(429, { error: 'invite.rate_limited' });
		}
		const token = createInvite(db, { groupId: params.groupId, createdBy: user.id });
		// Returned once and never stored in the clear — the row holds only the hash.
		return { inviteUrl: `${url.origin}/join/${token}` };
	}
};
