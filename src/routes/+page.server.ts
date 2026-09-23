import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = ({ locals }) => {
	// Both arms redirect, so +page.svelte is now unreachable. It stays as the
	// route's required component rather than as a page anyone sees.
	if (locals.user) redirect(303, '/groups');
	redirect(303, '/login');
};
