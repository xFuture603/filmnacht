import { hashPassword, validatePassword } from '$lib/server/auth/password';
import { reauthenticate } from '$lib/server/auth/reauth';
import { deleteOtherSessions, SESSION_COOKIE } from '$lib/server/auth/session';
import { hashToken } from '$lib/server/auth/tokens';
import { db } from '$lib/server/db';
import { retireResets } from '$lib/server/resets';
import { requireUser } from '$lib/server/groups';
import {
	EmailTakenError,
	regenerateLoginToken,
	setDisplayName,
	setEmail,
	setRatingMails,
	setPassword,
	userProfile,
	validateDisplayName,
	validateEmail
} from '$lib/server/users';
import { error, fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = ({ locals }) => {
	const user = requireUser(locals);
	// Read back from the database rather than from locals.user: after a display
	// name change, locals.user is the value hooks.server.ts resolved at the
	// start of this same request and is a name out of date.
	const profile = userProfile(db, user.id);
	// A live session whose account is gone should not render a half-empty page.
	if (!profile) error(401, 'The account for this session no longer exists');
	return profile;
};

/** Signs out every device but this one. */
function keepOnlyThisSession(userId: string, cookies: { get(name: string): string | undefined }) {
	const currentToken = cookies.get(SESSION_COOKIE);
	deleteOtherSessions(db, userId, currentToken ? hashToken(currentToken) : null);
}

export const actions: Actions = {
	/**
	 * The current password is required even though the caller is already signed
	 * in. A session cookie proves someone is at the keyboard; it does not prove
	 * it is the account's owner rather than whoever sat down at their unlocked
	 * laptop. This check is the only barrier between a borrowed session and a
	 * permanent takeover, which is also why it is rate-limited.
	 *
	 * The username is deliberately NOT editable here. Changing it frees the old
	 * one for someone else to claim, which is a real impersonation vector in a
	 * group that identifies people by it, and it invalidates every saved
	 * credential. Deferred to its own decision (PRD §13 backlog), not dropped.
	 */
	changePassword: async ({ locals, request, cookies }) => {
		const user = requireUser(locals);
		const form = await request.formData();

		// Authorization first, ahead of validating the new password: a caller who
		// cannot prove they own this account learns nothing else from the reply.
		const refused = await reauthenticate(user.id, form);
		if (refused) return refused;

		const password = validatePassword(form.get('newPassword'));
		if (!password) return fail(400, { error: 'auth.error.password' });
		if (password !== form.get('passwordRepeat')) {
			return fail(400, { error: 'auth.error.password_mismatch' });
		}

		const passwordHash = await hashPassword(password);

		// Past the last await. A password change is the other moment when "I think
		// someone else has access" is the reason you are here, so everything the
		// old password reached goes with it — rotating a credential while leaving
		// the access it bought alive and self-renewing would not be a change at all.
		//
		// BOTH credentials rotate, not just the password. The personal login link
		// is a standing, reusable, password-equivalent bearer token:
		// /login/[token] mints a session from it and does not consume it. Sweeping
		// sessions alone left someone who copied that link off an unlocked laptop
		// fully signed in after the victim changed her password — while the page
		// told her every other device had been signed out. The cost is that a
		// member's saved recovery link dies on every password change, which
		// profile.password_changed now says in both locales.
		setPassword(db, user.id, passwordHash);
		regenerateLoginToken(db, user.id);
		// Third credential. An emailed reset link outlives the password it was
		// issued to reset unless it is retired here, and it would then overwrite
		// the password this member just chose — while the very reason to be on
		// this form may be a reset email they did not request.
		retireResets(db, user.id);
		keepOnlyThisSession(user.id, cookies);
		return { success: 'profile.password_changed' };
	},

	changeDisplayName: async ({ locals, request }) => {
		const user = requireUser(locals);
		const form = await request.formData();
		const displayName = validateDisplayName(form.get('displayName'));
		// No uniqueness check, by design (decision 20): two friends may both be
		// "Alex" to the group. That is what the separate username is for.
		if (!displayName) return fail(400, { error: 'invite.error.name' });
		setDisplayName(db, user.id, displayName);
		return { success: 'profile.display_name_saved' };
	},

	setEmail: async ({ locals, request }) => {
		const user = requireUser(locals);
		const form = await request.formData();
		// A missing field is NOT an empty one. The form always sends `email`, and
		// clearing an address is submitting it empty — so a request that omits it
		// entirely is malformed, not a considered "remove my address", and must not
		// wipe one and answer "saved". validateEmail stays as it is: '' means clear
		// it, null means the value was not an address. Only the presence check is
		// the route's business, and Plan 4 resolving addresses back to accounts is
		// why collapsing the two at this boundary stops being harmless.
		const raw = form.get('email');
		if (raw === null) return fail(400, { error: 'profile.error.email' });
		const email = validateEmail(raw);
		if (email === null) return fail(400, { error: 'profile.error.email' });
		try {
			setEmail(db, user.id, email);
		} catch (err) {
			// The unique index is the guarantee, and this is what turns its
			// violation into a message rather than a 500. It does confirm that the
			// address has an account here — accepted deliberately for a private
			// 3-12 person group whose members already know each other, in exchange
			// for an error they can act on.
			if (err instanceof EmailTakenError) return fail(400, { error: 'profile.error.email_taken' });
			throw err;
		}
		return { success: 'profile.email_saved' };
	},

	setRatingMails: async ({ locals, request }) => {
		const user = requireUser(locals);
		// An unticked checkbox is simply absent from the form.
		const on = (await request.formData()).get('ratingMails') === 'on';
		setRatingMails(db, user.id, on);
		return { success: 'profile.rating_mails_saved' };
	},

	/**
	 * Revealing requires the current password too, consistent with
	 * changePassword directly above (PRD §9, decision 21 — a revised decision,
	 * not a bug fix). The link is the MORE powerful of the two credentials: it is
	 * permanent, reusable, and survives logout and session expiry, so a bare
	 * session cookie was buying an attacker with thirty seconds at an unlocked
	 * laptop an access that outlived the session they borrowed. Gating the
	 * stronger credential behind the same proof as the weaker one is the point.
	 *
	 * The cost decision 21 accepted — a member who forgot their password and
	 * saved no link in advance has no self-service way back — is no longer open.
	 * /reset emails a link where the operator configured SMTP, and /admin mints
	 * the same reset token with no mail server involved where they did not.
	 */
	reveal: async ({ locals, request, url, cookies }) => {
		const user = requireUser(locals);
		const form = await request.formData();

		const refused = await reauthenticate(user.id, form);
		if (refused) return refused;

		// Past the last await. Only the hash is stored (PRD §10), so the link
		// cannot be shown again — revealing mints a fresh one, which is also the
		// "revoke" of PRD §9. A leaked link may already have been used, so
		// revoking must also kill every session it granted — every session but
		// this device's own.
		const token = regenerateLoginToken(db, user.id);
		keepOnlyThisSession(user.id, cookies);
		return { loginUrl: `${url.origin}/login/${token}` };
	}
};
