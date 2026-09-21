import { locales, type Locale } from '$lib/i18n';
import { safeRedirectPath } from '$lib/server/redirect';
import { redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ request, cookies }) => {
	const data = await request.formData();
	const locale = String(data.get('locale') ?? '');
	if ((locales as readonly string[]).includes(locale)) {
		cookies.set('locale', locale as Locale, {
			path: '/',
			httpOnly: false,
			sameSite: 'lax',
			maxAge: 60 * 60 * 24 * 365
		});
	}
	redirect(303, safeRedirectPath(data.get('redirectTo')));
};
