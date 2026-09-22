import { beforeEach, describe, expect, it } from 'vitest';
import { applyMigrations, createDb, type DB } from './db/client';
import { getSetting, getTimezone, isSetupComplete, setSetting } from './settings';

let db: DB;

beforeEach(() => {
	db = createDb(':memory:').db;
	applyMigrations(db);
});

describe('settings', () => {
	it('returns null for a key that was never set', () => {
		setSetting(db, 'other', 'x');
		expect(getSetting(db, 'timezone')).toBeNull();
	});

	it('stores and reads a value', () => {
		setSetting(db, 'timezone', 'Europe/Berlin');
		expect(getSetting(db, 'timezone')).toBe('Europe/Berlin');
	});

	it('overwrites an existing value instead of failing on the primary key', () => {
		setSetting(db, 'timezone', 'Europe/Berlin');
		setSetting(db, 'timezone', 'Europe/Vienna');
		expect(getSetting(db, 'timezone')).toBe('Europe/Vienna');
	});

	it('defaults the timezone to UTC', () => {
		expect(getTimezone(db)).toBe('UTC');
	});

	it('reports setup as incomplete until the flag is set', () => {
		expect(isSetupComplete(db)).toBe(false);
		setSetting(db, 'setup_complete', '1');
		expect(isSetupComplete(db)).toBe(true);
	});
});
