import type { Locale } from '$lib/i18n';
import type { SessionUser } from '$lib/server/auth/session';

declare global {
	namespace App {
		interface Locals {
			locale: Locale;
			user: SessionUser | null;
		}
	}
}

export {};
