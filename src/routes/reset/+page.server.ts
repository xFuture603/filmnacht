import { t } from '$lib/i18n';
import { db } from '$lib/server/db';
import { isMailConfigured, sendMail } from '$lib/server/mail';
import { rateLimit } from '$lib/server/rate-limit';
import { createReset } from '$lib/server/resets';
import { userByEmail, validateEmail } from '$lib/server/users';
import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = ({ locals }) => {
	if (locals.user) redirect(303, '/profile');
	// Whether this instance can send mail is a property of the INSTANCE, not of
	// any address, so the page may say it out loud. What must never vary is the
	// answer to a submission.
	return { mailConfigured: isMailConfigured() };
};

export const actions: Actions = {
	/**
	 * Every submission gets one answer: unknown address, known address, mail
	 * sent, mail refused, no SMTP configured at all. Nothing below branches on
	 * which of those happened, and sendMail returns false instead of throwing
	 * precisely so that no branch is available to write by accident.
	 */
	default: async ({ request, getClientAddress, url, locals }) => {
		// The client-address gate is checked first and always — before the body
		// is even read. Its property is NOT that it cannot be evicted: rate-limit.ts
		// shares one map across every limiter and drops the oldest window by
		// insertion order regardless of its key, so a big enough flood does hand
		// this key a fresh budget. What holds is that an attacker cannot EXPAND
		// this key space — one key per source address — while they can mint email
		// addresses at will for the gate below. That is why this one goes first.
		if (!rateLimit(`reset-ip:${getClientAddress()}`, 5, 300_000)) {
			return fail(429, { error: 'reset.rate_limited' });
		}

		const form = await request.formData();
		// validateEmail rather than a bare trim/lowercase: it bounds what can
		// become a rate-limit key below to 254 characters with no whitespace, so
		// an attacker cannot plant megabyte-long keys in the process-wide window
		// map. It returns '' for an empty submission, which is not a request to
		// reset anything, and !email rejects that with the same message.
		const email = validateEmail(form.get('email'));
		if (!email) return fail(400, { error: 'reset.error.email' });

		// Defence in depth against one address hammered from many sources.
		// Second and never instead: this key IS attacker-chosen. It is applied to
		// every well-formed address, existing or not — a gate that only counted
		// real accounts would itself answer the question this route exists to
		// refuse to answer.
		if (!rateLimit(`reset-email:${email}`, 5, 300_000)) {
			return fail(429, { error: 'reset.rate_limited' });
		}

		const account = userByEmail(db, email);
		if (account) {
			const userId = account.id;
			const origin = url.origin;
			// Deferred past the response on purpose. The lookup above costs the same
			// for a real address and an invented one; the insert and
			// nodemailer.createTransport do not, and they left ~1.4ms on ~1.7ms — an
			// 80% relative gap, which is a signal rather than noise. This route's
			// whole stated property is that the two cases are indistinguishable, so
			// the work that distinguishes them happens after the reply is decided.
			//
			// The rate limit does not cover this: five attempts per address per five
			// minutes makes sampling slow, not impossible. And /profile's admitted
			// email disclosure is no precedent, because that one requires being
			// signed in — this route is open to anyone.
			const locale = locals.locale;
			setTimeout(() => {
				try {
					const token = createReset(db, userId);
					// ponytail: a floating send on the long-lived node server of PRD
					// §11. A shutdown between the insert and the send loses one message
					// and the member asks again. A queue earns its keep only once
					// delivery has to survive a restart.
					void sendMail(
						email,
						t(locale, 'mail.reset.subject'),
						t(locale, 'mail.reset.body', { link: `${origin}/reset/${token}` })
					).catch(() => {
						// sendMail's contract is that it never rejects. If that ever stops
						// being true, an unhandled rejection takes the instance down, which
						// is far worse than one reset mail nobody receives.
					});
				} catch {
					// A timer callback has no caller. A failed insert must cost one reset
					// mail, not the process.
					console.error('Reset delivery failed after the response was sent.');
				}
			}, 0);
		}

		return { success: 'reset.sent' };
	}
};
