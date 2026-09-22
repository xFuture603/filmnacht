import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { applyMigrations, createDb, type DB } from './db/client';
import { users } from './db/schema';
import { getSetting, getTimezone, isSetupComplete } from './settings';
import { claimInstance, guardRedirect } from './setup';

let db: DB;

beforeEach(() => {
	db = createDb(':memory:').db;
	applyMigrations(db);
});

describe('claimInstance', () => {
	it('creates the admin, stores the timezone and marks setup complete', () => {
		const admin = claimInstance(db, 'Ada', 'Europe/Berlin');
		expect(admin?.displayName).toBe('Ada');
		expect(getTimezone(db)).toBe('Europe/Berlin');
		expect(isSetupComplete(db)).toBe(true);
	});

	it('persists the admin flag on the row, not just the returned object', () => {
		const admin = claimInstance(db, 'Ada', 'Europe/Berlin');
		const row = db.select().from(users).where(eq(users.id, admin!.id)).get();
		expect(row?.isAdmin).toBe(true);
	});

	it('refuses a second claim', () => {
		claimInstance(db, 'Ada', 'Europe/Berlin');
		expect(claimInstance(db, 'Mallory', 'Europe/Vienna')).toBeNull();
	});

	it('leaves no trace of a refused second claim', () => {
		claimInstance(db, 'Ada', 'Europe/Berlin');
		claimInstance(db, 'Mallory', 'Europe/Vienna');
		expect(db.select().from(users).all()).toHaveLength(1);
		expect(getSetting(db, 'timezone')).toBe('Europe/Berlin');
	});
});

describe('guardRedirect', () => {
	it('funnels every path to /setup before the instance exists', () => {
		expect(guardRedirect('/', false)).toBe('/setup');
		expect(guardRedirect('/groups', false)).toBe('/setup');
	});

	it('lets /setup itself through before the instance exists', () => {
		expect(guardRedirect('/setup', false)).toBeNull();
	});

	it('exempts /locale, so the language switcher works on the setup screen', () => {
		expect(guardRedirect('/locale', false)).toBeNull();
	});

	it('sends /setup away once the instance exists', () => {
		expect(guardRedirect('/setup', true)).toBe('/');
	});

	it('leaves /locale alone once the instance exists', () => {
		// Merging /locale into the setup-path check would bounce every
		// post-setup language switch away unprocessed.
		expect(guardRedirect('/locale', true)).toBeNull();
	});

	it('leaves ordinary paths alone once the instance exists', () => {
		expect(guardRedirect('/groups', true)).toBeNull();
	});
});
