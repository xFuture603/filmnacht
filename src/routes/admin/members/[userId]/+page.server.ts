import { db } from '$lib/server/db';
import { users } from '$lib/server/db/schema';
import { requireAdmin } from '$lib/server/groups';
import { error } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import type { PageServerLoad } from './$types';

// The recovery link is minted by the admin page's own action.
export { actions } from '../../+page.server';

export const load: PageServerLoad = ({ locals, params }) => {
	requireAdmin(locals);
	// Three columns, never the row: it holds the password and login token hashes.
	const member = db
		.select({ id: users.id, username: users.username, displayName: users.displayName })
		.from(users)
		.where(eq(users.id, params.userId))
		.get();
	if (!member) error(404, 'Not found');
	return { member };
};
