import { dev } from '$app/environment';
import { createSession, setSessionCookie } from '$lib/server/auth/session';
import { db } from '$lib/server/db';
import { lookupInvite, redeemInvite } from '$lib/server/invites';
import { rateLimit } from '$lib/server/rate-limit';
import { createUser, validateDisplayName } from '$lib/server/users';
import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = ({ params, locals, getClientAddress }) => {
	if (!rateLimit(`join:${getClientAddress()}`, 20, 60_000)) {
		return { invite: null, rateLimited: true };
	}
	const invite = lookupInvite(db, params.token);
	if (invite && locals.user) {
		redeemInvite(db, params.token, locals.user.id);
		redirect(303, `/groups/${invite.groupId}`);
	}
	return { invite, rateLimited: false };
};

export const actions: Actions = {
	default: async ({ request, params, cookies, getClientAddress }) => {
		if (!rateLimit(`join:${getClientAddress()}`, 20, 60_000)) {
			return fail(429, { error: 'invite.rate_limited' });
		}

		const form = await request.formData();
		const displayName = validateDisplayName(form.get('displayName'));
		if (!displayName) return fail(400, { error: 'invite.error.name' });

		// Past the last await, nothing yields: better-sqlite3 is synchronous and
		// Node is single-threaded, so the invite cannot change under us between
		// this lookup and the redeem below. Checking before the await could not
		// make that promise.
		const invite = lookupInvite(db, params.token);
		if (!invite) return fail(410, { error: 'invite.invalid' });

		const user = createUser(db, displayName);
		const joinedGroupId = redeemInvite(db, params.token, user.id);
		if (!joinedGroupId) return fail(410, { error: 'invite.invalid' });

		const { token, expiresAt } = createSession(db, user.id);
		setSessionCookie(cookies, token, expiresAt, !dev);
		redirect(303, `/groups/${joinedGroupId}`);
	}
};
