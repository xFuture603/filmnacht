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
		const invite = lookupInvite(db, params.token);
		if (!invite) return fail(410, { error: 'invite.invalid' });

		const displayName = validateDisplayName((await request.formData()).get('displayName'));
		if (!displayName) return fail(400, { error: 'invite.error.name' });

		const user = createUser(db, displayName);
		redeemInvite(db, params.token, user.id);
		const { token, expiresAt } = createSession(db, user.id);
		setSessionCookie(cookies, token, expiresAt, !dev);
		redirect(303, `/groups/${invite.groupId}`);
	}
};
