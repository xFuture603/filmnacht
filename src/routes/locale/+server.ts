import { locales, type Locale } from '$lib/i18n';
import { redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ request, cookies }) => {
	const data = await request.formData();
	const locale = String(data.get('locale') ?? '');
	const redirectTo = String(data.get('redirectTo') ?? '/');
	if ((locales as readonly string[]).includes(locale)) {
		cookies.set('locale', locale as Locale, {
			path: '/',
			httpOnly: false,
			sameSite: 'lax',
			maxAge: 60 * 60 * 24 * 365
		});
	}
	// Only ever bounce back to a path on this instance, never to an absolute URL.
	redirect(303, redirectTo.startsWith('/') ? redirectTo : '/');
};
