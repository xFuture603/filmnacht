import { hashPassword, validatePassword } from '$lib/server/auth/password';
import { createSession, deleteOtherSessions, setSessionCookie } from '$lib/server/auth/session';
import { db } from '$lib/server/db';
import { rateLimit } from '$lib/server/rate-limit';
import { consumeReset } from '$lib/server/resets';
import { regenerateLoginToken, setPassword } from '$lib/server/users';
import { fail, redirect } from '@sveltejs/kit';
import type { Actions } from './$types';

// No `load`. An invalid token is only discovered on submit, deliberately: a
// load that rejected bad tokens early would turn "does this token exist" into a
// GET oracle, reachable by link preview and by a bare cross-site <img>.

export const actions: Actions = {
	default: async ({ params, request, cookies, getClientAddress, url }) => {
		// Not in the plan, added deliberately: this action runs scrypt (~100ms)
		// for anyone who can reach the URL, including for a token that never
		// existed — see the ordering note below, which is why the cost cannot be
		// skipped. Every other unauthenticated route here gates the same way
		// (/login, /login/[token], /join/[token], /reset). Keyed on the client
		// address, which a caller cannot mint at will; rate-limit.ts explains why
		// that matters and why no key in its map is un-evictable.
		if (!rateLimit(`reset-token:${getClientAddress()}`, 10, 60_000)) {
			return fail(429, { error: 'reset.rate_limited' });
		}

		const form = await request.formData();
		const password = validatePassword(form.get('password'));
		if (!password) return fail(400, { error: 'auth.error.password' });
		if (password !== form.get('passwordRepeat')) {
			return fail(400, { error: 'auth.error.password_mismatch' });
		}

		// Hashed BEFORE the token is spent, and the order is load-bearing twice
		// over: an invalid token pays the same ~100ms as a valid one, so this
		// route is no oracle for which links are live, and a mistyped repeat
		// above does not burn the single link the member has. Do not move it
		// below consumeReset to save the work on a doomed request — that saving
		// is the leak. Everything after this await is synchronous.
		const passwordHash = await hashPassword(password);

		const userId = consumeReset(db, params.token);
		// One message for never-existed, expired and already-used. They must not
		// be distinguishable.
		if (!userId) return fail(400, { error: 'reset.invalid' });

		// A revocation path revokes EVERY credential. Plan 3 shipped a password
		// change that swept sessions and left the personal login link alive, so
		// an attacker who had revealed one kept access through a change the
		// victim was told had locked them out. Here the member could not even
		// sign in, which makes "someone else has access" more likely, not less.
		setPassword(db, userId, passwordHash);
		// null, not a token: the second argument is a HASHED session id to spare,
		// and the caller here is not signed in, so every session goes.
		// createSession stores `id: hashToken(token)`, so passing a raw token
		// would silently spare nothing and still look correct.
		deleteOtherSessions(db, userId, null);
		regenerateLoginToken(db, userId);

		// Minted after the sweep, so the member's own new session survives it.
		const { token, expiresAt } = createSession(db, userId);
		setSessionCookie(cookies, token, expiresAt, url.protocol === 'https:');
		redirect(303, '/groups');
	}
};
