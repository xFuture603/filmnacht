import { dev } from '$app/environment';
import { createSession, setSessionCookie } from '$lib/server/auth/session';
import { db } from '$lib/server/db';
import { isSetupComplete, setSetting } from '$lib/server/settings';
import { createUser, validateDisplayName } from '$lib/server/users';
import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';

const timezones = Intl.supportedValuesOf('timeZone');

export const load: PageServerLoad = () => ({ timezones });

export const actions: Actions = {
	default: async ({ request, cookies }) => {
		// The guard in hooks.server.ts already redirects a completed instance away
		// from /setup; this re-check closes the race between two first visitors.
		if (isSetupComplete(db)) return fail(403, { error: 'setup.error.done' });

		const form = await request.formData();
		const displayName = validateDisplayName(form.get('displayName'));
		if (!displayName) return fail(400, { error: 'setup.error.name' });

		const timezone = String(form.get('timezone') ?? '');
		if (!timezones.includes(timezone)) return fail(400, { error: 'setup.error.timezone' });

		const user = createUser(db, displayName, true);
		setSetting(db, 'timezone', timezone);
		setSetting(db, 'setup_complete', '1');

		const { token, expiresAt } = createSession(db, user.id);
		setSessionCookie(cookies, token, expiresAt, !dev);
		redirect(303, '/groups');
	}
};
