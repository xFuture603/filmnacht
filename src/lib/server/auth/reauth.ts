import { verifyPassword } from '$lib/server/auth/password';
import { db } from '$lib/server/db';
import { rateLimit } from '$lib/server/rate-limit';
import { storedPasswordHash } from '$lib/server/users';
import { fail } from '@sveltejs/kit';

/**
 * The re-authentication every account-altering action requires. A session
 * cookie proves someone is at the keyboard; it does not prove it is the
 * account's owner rather than whoever sat down at their unlocked laptop.
 *
 * **ONE rate-limit bucket for every call site, deliberately.** They guess the
 * SAME secret, so a key per action would hand an attacker 5 + 5 + 5 attempts
 * against one password instead of 5. Do not "tidy" this into a key per action —
 * the shared bucket is the point, and splitting it silently multiplies the
 * budget. The key is named for the check, not for any one caller, so that stays
 * obvious: /profile changes a password, /profile reveals a login link, and
 * /admin mints a recovery link, all behind this one budget.
 *
 * The gate is consulted before the password is verified, so the budget is spent
 * by malformed submissions too. Trade-off accepted deliberately, not
 * overlooked, and the same one login/+page.server.ts records: rateLimit
 * consumes atomically, so five mistyped current passwords lock the owner out
 * for five minutes. It stays because refusing the work *before* scrypt runs is
 * what stops CPU exhaustion, and because this check is the only barrier between
 * a borrowed session and a permanent takeover. If the lockout ever bites in
 * practice, the upgrade is to verify first and consume only on failure, which
 * costs exactly the CPU this gate is here to save. Do not simply remove it.
 *
 * A user id is a safe key: the caller cannot mint more of them, so this limiter
 * cannot be used to flood rate-limit.ts's shared map. That is a statement about
 * causing eviction, not about surviving it — every window in that map is
 * evictable oldest-first, this one included.
 *
 * Returns the failure to return, or null once ownership is proven.
 */
export async function reauthenticate(userId: string, form: FormData) {
	if (!rateLimit(`reauth:${userId}`, 5, 300_000)) {
		return fail(429, { error: 'profile.rate_limited' });
	}
	// Verified unconditionally: no branch skips this.
	const ok = await verifyPassword(
		String(form.get('currentPassword') ?? ''),
		storedPasswordHash(db, userId)
	);
	return ok ? null : fail(400, { error: 'profile.error.current_password' });
}
