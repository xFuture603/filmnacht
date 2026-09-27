import { eq } from 'drizzle-orm';
import type { Locale } from '$lib/i18n';
import type { DB } from './db/client';
import { settings } from './db/schema';

export function getSetting(db: DB, key: string): string | null {
	return db.select().from(settings).where(eq(settings.key, key)).get()?.value ?? null;
}

export function setSetting(db: DB, key: string, value: string): void {
	db.insert(settings)
		.values({ key, value })
		.onConflictDoUpdate({ target: settings.key, set: { value } })
		.run();
}

export function isSetupComplete(db: DB): boolean {
	return getSetting(db, 'setup_complete') === '1';
}

/** PRD §12: one timezone for the whole instance. */
export function getTimezone(db: DB): string {
	return getSetting(db, 'timezone') ?? 'UTC';
}

/**
 * The language for the draw email (Plan 9). A row holding anything but
 * exactly 'de' reads as English, the same "unknown reads as default" rule
 * `groupSettings` applies to group settings.
 */
export function getEmailLocale(db: DB): Locale {
	return getSetting(db, 'email_locale') === 'de' ? 'de' : 'en';
}

export function setEmailLocale(db: DB, locale: Locale): void {
	setSetting(db, 'email_locale', locale);
}
