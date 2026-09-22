import { dev } from '$app/environment';
import { createSession, setSessionCookie } from '$lib/server/auth/session';
import { db } from '$lib/server/db';
import { rateLimit } from '$lib/server/rate-limit';
import { userByLoginToken } from '$lib/server/users';
import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = ({ params, cookies, getClientAddress }) => {
	if (!rateLimit(`login:${getClientAddress()}`, 10, 60_000)) {
		return { status: 'rate_limited' as const };
	}
	const user = userByLoginToken(db, params.token);
	if (!user) return { status: 'invalid' as const };

	const { token, expiresAt } = createSession(db, user.id);
	setSessionCookie(cookies, token, expiresAt, !dev);
	redirect(303, '/groups');
};
