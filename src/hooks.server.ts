import { building, dev } from '$app/environment';
import { env } from '$env/dynamic/private';
import { resolveLocale } from '$lib/i18n';
import {
	clearSessionCookie,
	SESSION_COOKIE,
	setSessionCookie,
	validateSession
} from '$lib/server/auth/session';
import { db } from '$lib/server/db';
import { notifyDraw } from '$lib/server/draw-mail';
import { startScheduler } from '$lib/server/scheduler';
import { isSetupComplete } from '$lib/server/settings';
import { guardRedirect } from '$lib/server/setup';
import { redirect, type Handle, type HandleServerError, type ServerInit } from '@sveltejs/kit';

export const init: ServerInit = () => {
	// Never during `vite build`: building only loads modules, and must not draw.
	// In dev, opt in explicitly: the repo's .env may hold real SMTP credentials
	// and `npm run dev` defaults to the live data/filmnacht.db, so a dev session
	// drawing and emailing on its own every time it starts is not something to
	// do by default.
	if (!building && (!dev || env.FILMNACHT_SCHEDULER === '1')) {
		startScheduler(db, (nightId) => notifyDraw(db, nightId));
	}
};

/**
 * Replaces SvelteKit's default error logger, which prints the request URL.
 *
 * Every token this app hands out lives in a path — /reset/<token>,
 * /login/<token>, /join/<token> — so that default wrote a live, single-use
 * credential into the operator's log on any 500, where it outlives the request
 * and gets pasted into bug reports. Seen on the production build during the
 * Plan 4 walkthrough: a FOREIGN KEY failure inside the reset action logged
 * `[500] POST /reset/cONuogJsOHRgB07ew8yaoA` verbatim. Same class as the SMTP
 * credentials mail.ts refuses to log, and the same fix — redact at the
 * boundary rather than trust every future error to be harmless.
 *
 * `event.route.id` is the PATTERN, never the value, so an operator still sees
 * which route failed and gets the whole error and its stack. Returning nothing
 * leaves SvelteKit's own `{ message: 'Internal Error' }` body untouched, so
 * nothing about the response changes — do not "improve" this by returning the
 * message, which is how a stack trace reaches a browser.
 */
export const handleError: HandleServerError = ({ error, event, status }) => {
	console.error(`[${status}] ${event.request.method} ${event.route.id ?? '(unrouted)'}`, error);
};

export const handle: Handle = async ({ event, resolve }) => {
	event.locals.locale = resolveLocale(
		event.request.headers.get('accept-language'),
		event.cookies.get('locale')
	);

	const token = event.cookies.get(SESSION_COOKIE);
	const session = token ? validateSession(db, token) : null;
	event.locals.user = session?.user ?? null;
	if (session?.refreshed) {
		setSessionCookie(event.cookies, token!, session.expiresAt, event.url.protocol === 'https:');
	}
	if (token && !session) clearSessionCookie(event.cookies);

	// Until an instance admin exists there is nothing to show and nobody to show
	// it to, so every path funnels into /setup (PRD §11). /locale is exempt from
	// that funnel (but NOT from the "leave /setup alone once it's done" rule
	// below) so the language switcher works both on the setup screen and after,
	// rather than having every post-setup submit bounce to / unprocessed.
	const target = guardRedirect(event.url.pathname, isSetupComplete(db));
	if (target) redirect(303, target);

	return resolve(event, {
		transformPageChunk: ({ html }) => html.replace('%lang%', event.locals.locale)
	});
};
