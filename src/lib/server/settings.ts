import { eq } from 'drizzle-orm';
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
