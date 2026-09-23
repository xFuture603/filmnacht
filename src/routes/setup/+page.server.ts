import { hashPassword } from '$lib/server/auth/password';
import { createSession, setSessionCookie } from '$lib/server/auth/session';
import { db } from '$lib/server/db';
import { claimInstance } from '$lib/server/setup';
import { validateDisplayName } from '$lib/server/users';
import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';

const timezones = Intl.supportedValuesOf('timeZone');

export const load: PageServerLoad = () => ({ timezones });

export const actions: Actions = {
	default: async ({ request, cookies, url }) => {
		const form = await request.formData();
		const displayName = validateDisplayName(form.get('displayName'));
		if (!displayName) return fail(400, { error: 'setup.error.name' });

		const timezone = String(form.get('timezone') ?? '');
		if (!timezones.includes(timezone)) return fail(400, { error: 'setup.error.timezone' });

		// Task 4 collects a real username and password from this form; until then
		// mint an unguessable placeholder so the admin account cannot be signed
		// into directly, matching today's link-only behaviour. hashPassword is
		// async and must run here, before claimInstance's transaction, never inside it.
		const passwordHash = await hashPassword(crypto.randomUUID());

		const admin = claimInstance(db, {
			username: `user-${crypto.randomUUID()}`,
			displayName,
			passwordHash,
			timezone
		});
		if (!admin) return fail(403, { error: 'setup.error.done' });

		const { token, expiresAt } = createSession(db, admin.id);
		// A protocol check, not `dev`: `dev` is only true under `vite dev`, so in
		// production over plain HTTP (the Pi/Synology target of PRD §11) `!dev`
		// would mark this cookie secure and the browser would silently drop it.
		setSessionCookie(cookies, token, expiresAt, url.protocol === 'https:');
		redirect(303, '/groups');
	}
};
