import { db } from '$lib/server/db';
import {
	leaveGroup,
	listMembers,
	requireMember,
	requireOwner,
	requireUser
} from '$lib/server/groups';
import { createInvite } from '$lib/server/invites';
import { rateLimit } from '$lib/server/rate-limit';
import { nextNight } from '$lib/server/nights';
import { visiblePool } from '$lib/server/pool';
import { nightsToRate } from '$lib/server/ratings';
import { visit } from '$lib/server/seen';
import { getTimezone } from '$lib/server/settings';
import { formatDay, formatShortWhen } from '$lib/time';
import { countOpenSuggestions, withdrawSuggestion, type PoolEntry } from '$lib/server/suggestions';
import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = ({ locals, params }) => {
	const user = requireUser(locals);
	const group = requireMember(db, user.id, params.groupId);
	// After requireMember: a non-member must not mark anything as seen.
	const { newIds, counts } = visit(db, user.id, params.groupId, 'pool');
	const next = nextNight(db, params.groupId, user.id, group.settings, new Date());
	const toRate = nightsToRate(db, params.groupId, user.id, new Date()).map((n) => ({
		id: n.id,
		title: n.title,
		closes: formatDay(n.closesAt, getTimezone(db), locals.locale)
	}));
	const day = (at: Date) => formatDay(at, getTimezone(db), locals.locale);
	const entries = visiblePool(db, params.groupId, user.id, group.settings.resultVisible).map(
		(entry) => ({
			...entry,
			isNew: newIds.has(entry.suggestionId),
			drawnFor: entry.night && !entry.night.watched ? day(entry.night.scheduledAt) : null,
			watchedOn: entry.night?.watched ? day(entry.night.scheduledAt) : null
		})
	);
	return {
		group,
		members: listMembers(db, params.groupId),
		pool: entries.filter((entry) => entry.status === 'open'),
		drawn: entries.filter((entry) => entry.status === 'drawn').sort(byNight),
		newCounts: counts,
		toRate,
		next: next && {
			...next,
			when: formatShortWhen(next.scheduledAt, getTimezone(db), locals.locale)
		},
		used: countOpenSuggestions(db, params.groupId, user.id),
		max: group.settings.maxOpenSuggestions
	};
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
	},

	withdraw: async ({ request, locals, params }) => {
		const user = requireUser(locals);
		// Membership is checked before anything is read or written, even though
		// withdrawSuggestion is itself owner-scoped — a non-member must not learn
		// the group exists.
		requireMember(db, user.id, params.groupId);
		const form = await request.formData();
		const outcome = withdrawSuggestion(
			db,
			user.id,
			params.groupId,
			String(form.get('suggestionId') ?? '')
		);
		if (outcome !== 'ok') return fail(400, { error: `pool.error.${outcome}` });
		return { withdrawn: true };
	},

	leave: async ({ request, locals, params }) => {
		const user = requireUser(locals);
		const group = requireMember(db, user.id, params.groupId);
		// One owner per group and no hand-over yet: the owner deletes it instead.
		if (group.role === 'owner') return fail(400, { error: 'groups.error.owner_leave' });
		if ((await request.formData()).get('confirm') !== 'on') {
			return fail(400, { confirm: 'leave' });
		}
		leaveGroup(db, user.id, params.groupId);
		redirect(303, '/groups');
	}
};

/**
 * The film still to come first: it is next. Then the history, latest night
 * first. A drawn film with no night left sorts last.
 */
function byNight(a: PoolEntry, b: PoolEntry): number {
	const rank = (e: PoolEntry) => (!e.night ? 2 : e.night.watched ? 1 : 0);
	if (rank(a) !== rank(b)) return rank(a) - rank(b);
	const at = (e: PoolEntry) => e.night?.scheduledAt.getTime() ?? 0;
	return rank(a) === 0 ? at(a) - at(b) : at(b) - at(a);
}
