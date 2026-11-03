import { db } from '$lib/server/db';
import { groups, memberships, users } from '$lib/server/db/schema';
import { requireAdmin } from '$lib/server/groups';
import { error, redirect } from '@sveltejs/kit';
import { and, count, eq, isNull } from 'drizzle-orm';
import { actions as admin } from '../../+page.server';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = ({ locals, params }) => {
	requireAdmin(locals);
	const group = db
		.select({
			id: groups.id,
			name: groups.name,
			owner: users.displayName,
			members: count(memberships.id)
		})
		.from(groups)
		.innerJoin(users, eq(users.id, groups.ownerId))
		.leftJoin(memberships, and(eq(memberships.groupId, groups.id), isNull(memberships.leftAt)))
		.where(eq(groups.id, params.groupId))
		.groupBy(groups.id)
		.get();
	if (!group) error(404, 'Not found');
	return { group };
};

export const actions: Actions = {
	deleteGroup: async (event) => {
		const result = await admin.deleteGroup(event as never);
		// The group is gone, so this page would answer 404: back to the groups,
		// which names what was deleted.
		if (result && 'deletedGroup' in result) {
			redirect(303, `/admin/groups?deleted=${encodeURIComponent(result.deletedGroup)}`);
		}
		return result;
	}
};
