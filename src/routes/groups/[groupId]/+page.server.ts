import { db } from '$lib/server/db';
import { listMembers, requireMember, requireOwner, requireUser } from '$lib/server/groups';
import { createInvite } from '$lib/server/invites';
import { rateLimit } from '$lib/server/rate-limit';
import { unrevealedDrawnIds } from '$lib/server/nights';
import { countOpenSuggestions, listPool, withdrawSuggestion } from '$lib/server/suggestions';
import { fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = ({ locals, params }) => {
	const user = requireUser(locals);
	const group = requireMember(db, user.id, params.groupId);
	return {
		group,
		members: listMembers(db, params.groupId),
		pool: visiblePool(params.groupId, user.id, group.settings.resultVisible),
		used: countOpenSuggestions(db, params.groupId, user.id),
		max: group.settings.maxOpenSuggestions
	};
};

/**
 * With `resultVisible: 'on_night'` the film drawn for a night still to come is
 * a surprise, and a pool entry badged "drawn" would give it away. It is left
 * out of the pool until the night starts, not merely unbadged: withdrawing it
 * would answer "already drawn" and say the same thing.
 */
function visiblePool(groupId: string, viewerId: string, resultVisible: 'immediately' | 'on_night') {
	const pool = listPool(db, groupId, viewerId);
	if (resultVisible === 'immediately') return pool;
	const hidden = unrevealedDrawnIds(db, groupId, new Date());
	return pool.filter((entry) => !hidden.has(entry.suggestionId));
}

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
	},

	withdraw: async ({ request, locals, params }) => {
		const user = requireUser(locals);
		// Membership is checked before anything is read or written, even though
		// withdrawSuggestion is itself owner-scoped — a non-member must not learn
		// the group exists.
		requireMember(db, user.id, params.groupId);
		const form = await request.formData();
		const outcome = withdrawSuggestion(db, user.id, String(form.get('suggestionId') ?? ''));
		if (outcome !== 'ok') return fail(400, { error: `pool.error.${outcome}` });
		return { withdrawn: true };
	}
};
