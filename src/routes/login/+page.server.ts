import { verifyPassword } from '$lib/server/auth/password';
import { createSession, setSessionCookie } from '$lib/server/auth/session';
import { db } from '$lib/server/db';
import { rateLimit } from '$lib/server/rate-limit';
import { safeRedirectPath } from '$lib/server/redirect';
import { userByUsername, validateUsername } from '$lib/server/users';
import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = ({ locals, url }) => {
	if (locals.user) redirect(303, '/groups');
	return { redirectTo: safeRedirectPath(url.searchParams.get('redirectTo'), '/groups') };
};

export const actions: Actions = {
	default: async ({ request, cookies, getClientAddress, url }) => {
		// The address gate is primary and is checked first: it is the one an
		// attacker cannot evict, because the key is not one they choose.
		if (!rateLimit(`login-ip:${getClientAddress()}`, 10, 60_000)) {
			return fail(429, { error: 'login.rate_limited' });
		}

		const form = await request.formData();
		// validateUsername rather than a bare trim/lowercase: it bounds what can
		// become a rate-limit key below to 32 characters of [a-z0-9._-]. A raw
		// form value would let an attacker plant megabyte-long keys in the
		// process-wide window map. An unusable username becomes '' — no account
		// can hold that, so it takes the same path, and the same ~100ms, as any
		// other wrong guess. Nothing here returns early.
		const username = validateUsername(form.get('username')) ?? '';
		const password = String(form.get('password') ?? '');

		// Defence in depth against a distributed attack on one account. Second
		// and never instead: this key IS attacker-chosen, so its window is
		// evictable under a key flood (see rate-limit.ts) and it cannot be the
		// only gate.
		//
		// Trade-off accepted deliberately, not overlooked: this gate blocks, so
		// ten failures in five minutes lock a known user out of their own
		// account, and rateLimit consumes atomically — there is no
		// check-without-consume variant to reach for. It stays because refusing
		// the work *before* scrypt runs is what stops CPU exhaustion. If lockout
		// ever bites in practice, the upgrade is to let a correct password
		// through this gate (verify first, then decide), which costs exactly the
		// CPU the gate is here to save.
		if (username && !rateLimit(`login-user:${username}`, 10, 300_000)) {
			return fail(429, { error: 'login.rate_limited' });
		}

		const account = userByUsername(db, username);
		// Called unconditionally, including when there is no such account:
		// returning early here would take microseconds where a real check takes
		// ~100ms, and that difference tells an attacker which usernames exist.
		const ok = await verifyPassword(password, account?.passwordHash ?? null);
		if (!account || !ok) return fail(400, { error: 'login.failed' });

		// Past the last await.
		const { token, expiresAt } = createSession(db, account.id);
		setSessionCookie(cookies, token, expiresAt, url.protocol === 'https:');
		redirect(303, safeRedirectPath(form.get('redirectTo'), '/groups'));
	}
};
