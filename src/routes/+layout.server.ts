import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = ({ locals, url }) => ({
	locale: locals.locale,
	user: locals.user,
	pathname: url.pathname
});
