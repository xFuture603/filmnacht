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
	default: async ({ request, getClientAddress, url }) => {
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
			const token = createReset(db, account.id);
			// Not awaited, deliberately. mail.ts allows a dead host 10s to connect
			// and 20s on the socket, so awaiting here would answer a known address
			// up to twenty seconds later than an unknown one — the same bytes
			// arriving at a tell-tale time, which is the enumeration oracle this
			// whole route exists to close, and the hung page Review Focus 1
			// forbids. The result is discarded for the same reason.
			//
			// ponytail: a floating promise on the long-lived node server of PRD
			// §11. A shutdown between the insert and the send loses that one
			// message and the member asks for another. A queue only earns its
			// keep once delivery has to survive a restart.
			void sendMail(
				email,
				'Reset your filmnacht password',
				`Open this link within the hour to choose a new password:\n\n${url.origin}/reset/${token}\n\nIf you did not ask for this, nothing has changed and you can ignore this message.`
			).catch(() => {
				// sendMail's contract is that it never rejects. Should that ever
				// stop being true, an unhandled rejection takes the whole instance
				// down, which is a great deal worse than one reset mail nobody gets.
			});
		}

		return { success: 'reset.sent' };
	}
};
