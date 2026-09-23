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
		// The address gate is checked first and always. Its real property is NOT
		// that it cannot be evicted — it can: rate-limit.ts shares one map across
		// every limiter and, when that map is full, drops the oldest window by
		// insertion order regardless of its key. This key is in there like any
		// other, so a big enough flood does hand this address a fresh budget.
		// What holds is that an attacker cannot EXPAND this key space — one key
		// per source address — while they can mint login-user: keys at will.
		// That is why this one goes first.
		//
		// ponytail: a hard cap only while the map is not being flooded. Filling
		// it takes 10,000 live windows, and a login-user: window lives 300s, so
		// that is >=33 req/s sustained — roughly 200 source addresses at the 10
		// per minute this gate allows. Below that rate neither gate is evicted;
		// above it both degrade continuously. Left alone because it does not pay:
		// cycling the map to drop one specific key costs ~10,000 insertions, more
		// requests than the guesses it buys, and the 300s TTL would have expired
		// that window anyway. Upgrade, if a public instance ever makes the flood
		// worthwhile: a separate map per limiter class in rate-limit.ts, so that
		// flooding one cannot evict another.
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
