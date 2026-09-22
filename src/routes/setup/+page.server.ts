import { dev } from '$app/environment';
import { createSession, setSessionCookie } from '$lib/server/auth/session';
import { db } from '$lib/server/db';
import { claimInstance } from '$lib/server/setup';
import { validateDisplayName } from '$lib/server/users';
import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';

const timezones = Intl.supportedValuesOf('timeZone');

export const load: PageServerLoad = () => ({ timezones });

export const actions: Actions = {
	default: async ({ request, cookies }) => {
		const form = await request.formData();
		const displayName = validateDisplayName(form.get('displayName'));
		if (!displayName) return fail(400, { error: 'setup.error.name' });

		const timezone = String(form.get('timezone') ?? '');
		if (!timezones.includes(timezone)) return fail(400, { error: 'setup.error.timezone' });

		const admin = claimInstance(db, displayName, timezone);
		if (!admin) return fail(403, { error: 'setup.error.done' });

		const { token, expiresAt } = createSession(db, admin.id);
		setSessionCookie(cookies, token, expiresAt, !dev);
		redirect(303, '/groups');
	}
};
