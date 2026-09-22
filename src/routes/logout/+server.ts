import { clearSessionCookie, deleteSession, SESSION_COOKIE } from '$lib/server/auth/session';
import { db } from '$lib/server/db';
import { redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = ({ cookies }) => {
	const token = cookies.get(SESSION_COOKIE);
	if (token) deleteSession(db, token);
	clearSessionCookie(cookies);
	redirect(303, '/');
};
