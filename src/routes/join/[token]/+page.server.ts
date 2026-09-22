import { createSession, setSessionCookie } from '$lib/server/auth/session';
import { db } from '$lib/server/db';
import { lookupInvite, redeemInvite } from '$lib/server/invites';
import { rateLimit } from '$lib/server/rate-limit';
import { createUser, validateDisplayName } from '$lib/server/users';
import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';

// `load` runs on a GET, including on link hover (app.html preloads on hover)
// and on a bare cross-site <img> request — neither is a user confirming
// anything. It must only read. Joining happens in the action below, which is
// a POST a browser will not issue without the visitor pressing the button.
export const load: PageServerLoad = ({ params, locals, getClientAddress }) => {
	if (!rateLimit(`join:${getClientAddress()}`, 20, 60_000)) {
		return { invite: null, rateLimited: true, signedIn: !!locals.user };
	}
	const invite = lookupInvite(db, params.token);
	return { invite, rateLimited: false, signedIn: !!locals.user };
};

export const actions: Actions = {
	default: async ({ request, params, cookies, getClientAddress, locals, url }) => {
		if (!rateLimit(`join:${getClientAddress()}`, 20, 60_000)) {
			return fail(429, { error: 'invite.rate_limited' });
		}

		if (locals.user) {
			const joinedGroupId = redeemInvite(db, params.token, locals.user.id);
			if (!joinedGroupId) return fail(410, { error: 'invite.invalid' });
			redirect(303, `/groups/${joinedGroupId}`);
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
		setSessionCookie(cookies, token, expiresAt, url.protocol === 'https:');
		redirect(303, `/groups/${joinedGroupId}`);
	}
};
