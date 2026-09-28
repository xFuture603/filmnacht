import { env } from '$env/dynamic/private';
import { reauthenticate } from '$lib/server/auth/reauth';
import { db } from '$lib/server/db';
import { users } from '$lib/server/db/schema';
import { requireUser } from '$lib/server/groups';
import { mailStatus, sendTestMail } from '$lib/server/mail';
import { rateLimit } from '$lib/server/rate-limit';
import { createReset } from '$lib/server/resets';
import { getEmailLocale, getTimezone, setEmailLocale, setSetting } from '$lib/server/settings';
import { userProfile } from '$lib/server/users';
import { error, fail } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import type { Actions, PageServerLoad } from './$types';

const timezones = Intl.supportedValuesOf('timeZone');

/**
 * nodemailer's error codes, grouped into the one thing the admin can act on.
 * Only the code is ever shown; see sendTestMail.
 */
function mailHint(code: string): 'config' | 'auth' | 'connection' | 'tls' | 'address' | 'unknown' {
	if (code === 'NOT_CONFIGURED') return 'config';
	if (code === 'EAUTH') return 'auth';
	if (['ECONNECTION', 'ECONNREFUSED', 'ETIMEDOUT', 'ESOCKET', 'EDNS', 'ENOTFOUND'].includes(code)) {
		return 'connection';
	}
	if (code === 'ETLS') return 'tls';
	if (['EENVELOPE', 'EMESSAGE'].includes(code)) return 'address';
	return 'unknown';
}

/** Admin-only, checked before anything reads or reveals instance state. */
function requireAdmin(locals: App.Locals) {
	const user = requireUser(locals);
	// A developer-facing label; +error.svelte renders the translated error.403.
	if (!user.isAdmin) error(403, 'Only the instance admin can do this');
	return user;
}

export const load: PageServerLoad = ({ locals }) => {
	const admin = requireAdmin(locals);
	return {
		timezone: getTimezone(db),
		timezones,
		emailLocale: getEmailLocale(db),
		// Where mail points and whether it works; never the login or password.
		mail: mailStatus(),
		tmdb: Boolean(env.TMDB_API_KEY),
		// The test email goes to the admin's own address, if they saved one.
		myEmail: userProfile(db, admin.id)?.email ?? null,
		// Three columns and no more. This object is serialised into the page, so
		// selecting the row would put password_hash and login_token_hash into the
		// admin's HTML source.
		members: db
			.select({ id: users.id, username: users.username, displayName: users.displayName })
			.from(users)
			.orderBy(users.username)
			.all()
	};
};

export const actions: Actions = {
	/** PRD §10: the instance setting the admin edits in the UI, timezone first. */
	timezone: async ({ locals, request }) => {
		requireAdmin(locals);
		const timezone = String((await request.formData()).get('timezone') ?? '');
		if (!timezones.includes(timezone)) return fail(400, { error: 'setup.error.timezone' });
		setSetting(db, 'timezone', timezone);
		return { timezoneSaved: true };
	},

	/** Plan 8: the language the draw email is sent in. */
	emailLocale: async ({ locals, request }) => {
		requireAdmin(locals);
		const locale = String((await request.formData()).get('locale') ?? '');
		if (locale !== 'en' && locale !== 'de') return fail(400, { error: 'admin.error.email_locale' });
		setEmailLocale(db, locale);
		return { emailLocaleSaved: true };
	},

	testMail: async ({ locals }) => {
		const admin = requireAdmin(locals);
		// Each attempt can hold a connection open for up to 20s.
		if (!rateLimit(`mail-test:${admin.id}`, 5, 60_000)) {
			return fail(429, { error: 'admin.error.mail_rate' });
		}
		const to = userProfile(db, admin.id)?.email;
		if (!to) return fail(400, { error: 'admin.error.no_email' });
		const result = await sendTestMail(to);
		if (result.ok) return { mailSent: to };
		return fail(400, { mailCode: result.code, mailHint: mailHint(result.code) });
	},

	/**
	 * The SMTP-free half of recovery, and the reason PRD §12's rule holds: a
	 * member who forgot their password, saved no login link and has no email
	 * address still has a way back that involves no mail server at all.
	 *
	 * Requires the admin's own password. Minting a credential for another
	 * account is at least as powerful as revealing your own, which decision 21
	 * gated — an admin's unlocked laptop must not be a master key.
	 *
	 * Minting changes nothing about the target account. The link is an ordinary
	 * reset token, so /reset/<token> is what sets the password, sweeps every
	 * session and rotates the login link — which is also how the member finds
	 * out this happened. That is a feature: an admin cannot quietly mint and
	 * use one without the owner being signed out of everything.
	 */
	recover: async ({ locals, request, url }) => {
		const admin = requireAdmin(locals);
		const form = await request.formData();

		// Authorization before anything else is read from the form, the same order
		// /profile uses: a caller who cannot prove they own this account learns
		// nothing else from the reply.
		const refused = await reauthenticate(admin.id, form);
		if (refused) return refused;

		const target = db
			.select({ id: users.id, displayName: users.displayName })
			.from(users)
			.where(eq(users.id, String(form.get('userId') ?? '')))
			.get();
		if (!target) return fail(400, { error: 'admin.error.no_such_member' });

		const token = createReset(db, target.id);
		// Shown once and never stored in plaintext (PRD §10). The admin hands it
		// over out of band.
		return { recoveryUrl: `${url.origin}/reset/${token}`, recoveredName: target.displayName };
	}
};
