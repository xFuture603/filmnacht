import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = ({ locals, url }) => ({
	locale: locals.locale,
	user: locals.user,
	pathname: url.pathname,
	// ORIGIN as the server applies it; the layout compares it with the browser's.
	serverOrigin: url.origin
});
