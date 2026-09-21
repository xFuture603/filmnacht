import { dev } from '$app/environment';
import { resolveLocale } from '$lib/i18n';
import {
	clearSessionCookie,
	SESSION_COOKIE,
	setSessionCookie,
	validateSession
} from '$lib/server/auth/session';
import { db } from '$lib/server/db';
import { isSetupComplete } from '$lib/server/settings';
import { redirect, type Handle } from '@sveltejs/kit';

export const handle: Handle = async ({ event, resolve }) => {
	event.locals.locale = resolveLocale(
		event.request.headers.get('accept-language'),
		event.cookies.get('locale')
	);

	const token = event.cookies.get(SESSION_COOKIE);
	const session = token ? validateSession(db, token) : null;
	event.locals.user = session?.user ?? null;
	if (session?.refreshed) setSessionCookie(event.cookies, token!, session.expiresAt, !dev);
	if (token && !session) clearSessionCookie(event.cookies);

	// Until an instance admin exists there is nothing to show and nobody to show
	// it to, so every path funnels into /setup (PRD §11). /locale is exempt from
	// that funnel (but NOT from the "leave /setup alone once it's done" rule
	// below) so the language switcher works both on the setup screen and after,
	// rather than having every post-setup submit bounce to / unprocessed.
	const setupPath = event.url.pathname.startsWith('/setup');
	const localeRoute = event.url.pathname === '/locale';
	const setupComplete = isSetupComplete(db);
	if (!setupComplete && !setupPath && !localeRoute) redirect(303, '/setup');
	if (setupComplete && setupPath) redirect(303, '/');

	return resolve(event, {
		transformPageChunk: ({ html }) => html.replace('%lang%', event.locals.locale)
	});
};
