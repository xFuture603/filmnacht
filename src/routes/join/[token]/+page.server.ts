import { hashPassword, validatePassword } from '$lib/server/auth/password';
import { createSession, setSessionCookie } from '$lib/server/auth/session';
import { db } from '$lib/server/db';
import { lookupInvite, redeemInvite } from '$lib/server/invites';
import { rateLimit } from '$lib/server/rate-limit';
import {
	createUser,
	usernameTaken,
	validateDisplayName,
	validateUsername
} from '$lib/server/users';
import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';

// `load` runs on a GET, including on link hover (app.html preloads on hover)
// and on a bare cross-site <img> request — neither is a user confirming
// anything. It must only read. Joining happens in the action below, which is
// a POST a browser will not issue without the visitor pressing the button.
export const load: PageServerLoad = ({ params, locals, getClientAddress }) => {
	if (!rateLimit(`join:${getClientAddress()}`, 20, 60_000)) {
		return { invite: null, rateLimited: true, user: locals.user };
	}
	const invite = lookupInvite(db, params.token);
	return { invite, rateLimited: false, user: locals.user };
};

export const actions: Actions = {
	default: async ({ request, params, cookies, getClientAddress, locals, url }) => {
		if (!rateLimit(`join:${getClientAddress()}`, 20, 60_000)) {
			return fail(429, { error: 'invite.rate_limited' });
		}

		// Authorization, deliberately above anything that reveals instance state:
		// without a valid invite a visitor must not learn whether a username
		// exists. The lookup below, past the last await, stays the authoritative
		// freshness check. Check twice — see FIX 8, movie-pool decisions.
		if (!lookupInvite(db, params.token)) return fail(410, { error: 'invite.invalid' });

		// A signed-in visitor joins as themselves, not as a new account: a second
		// account would split their suggestions, ratings and history across two
		// identities, and Plan 5's fairness-weighted draw would count them as two
		// different people. redeemInvite does its own lookup internally and
		// nothing here is async, so there is no race to guard against.
		if (locals.user) {
			const joinedGroupId = redeemInvite(db, params.token, locals.user.id);
			if (!joinedGroupId) return fail(410, { error: 'invite.invalid' });
			redirect(303, `/groups/${joinedGroupId}`);
		}

		const form = await request.formData();
		const username = validateUsername(form.get('username'));
		if (!username) return fail(400, { error: 'auth.error.username' });
		const displayName = validateDisplayName(form.get('displayName'));
		if (!displayName) return fail(400, { error: 'invite.error.name' });
		const password = validatePassword(form.get('password'));
		if (!password) return fail(400, { error: 'auth.error.password' });
		if (password !== form.get('passwordRepeat')) {
			return fail(400, { error: 'auth.error.password_mismatch' });
		}

		// Cheap rejection before the expensive hash: a taken username is by far
		// the most common failure here, and hashing first would burn ~100ms of
		// CPU on every one of them. Reaching this line already required a live
		// invite (checked above), so a visitor who gets here CAN tell a taken
		// username from a free one — that is fine and intended: they could just
		// as easily join and read the member list. The early check only stops
		// someone with no invite at all from learning anything.
		if (usernameTaken(db, username)) return fail(400, { error: 'auth.error.username_taken' });

		const passwordHash = await hashPassword(password);

		// Past the last await. The invite lookup, the account creation and the
		// redemption are now one uninterruptible sequence, which is what stops a
		// second tab from racing an invite that is expiring or filling up.
		const invite = lookupInvite(db, params.token);
		if (!invite) return fail(410, { error: 'invite.invalid' });

		const user = createUser(db, { username, displayName, passwordHash });
		const joinedGroupId = redeemInvite(db, params.token, user.id);
		if (!joinedGroupId) return fail(410, { error: 'invite.invalid' });

		const { token, expiresAt } = createSession(db, user.id);
		setSessionCookie(cookies, token, expiresAt, url.protocol === 'https:');
		redirect(303, `/groups/${joinedGroupId}`);
	}
};
