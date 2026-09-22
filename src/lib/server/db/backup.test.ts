import Database from 'better-sqlite3';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { backupAndMigrate, backupIfPending, createDb } from './client';

const dirs: string[] = [];

function tempFile() {
	const dir = mkdtempSync(join(tmpdir(), 'filmnacht-'));
	dirs.push(dir);
	return join(dir, 'filmnacht.db');
}

afterEach(() => {
	for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('backupAndMigrate', () => {
	it('does not back up a brand-new, table-less database on its first migration', () => {
		const file = tempFile();
		const { sqlite, db } = createDb(file);
		expect(backupAndMigrate(sqlite, db, file)).toBeNull();
		sqlite.close();
	});

	it('is a no-op on the second start, when nothing is pending', () => {
		const file = tempFile();
		const first = createDb(file);
		backupAndMigrate(first.sqlite, first.db, file);
		first.sqlite.close();

		const second = createDb(file);
		expect(backupAndMigrate(second.sqlite, second.db, file)).toBeNull();
		second.sqlite.close();
	});

	it('backs up a populated database that has a migration outstanding', () => {
		const file = tempFile();
		const first = createDb(file);
		backupAndMigrate(first.sqlite, first.db, file);
		first.sqlite.close();

		// Stand in for a release that ships a migration this database has not
		// seen. Only the backup decision is under test here — re-running the
		// migration itself would fail on tables that already exist.
		const second = createDb(file);
		second.sqlite.exec('DELETE FROM __drizzle_migrations');
		const backup = backupIfPending(second.sqlite, file);
		second.sqlite.close();

		expect(backup).not.toBeNull();
		expect(backup).toMatch(/filmnacht\.db\.pre-.+\.bak$/);
		expect(existsSync(backup!)).toBe(true);
	});

	it('does not back up an empty database file', () => {
		const file = tempFile();
		const { sqlite } = createDb(file);
		expect(backupIfPending(sqlite, file)).toBeNull();
		sqlite.close();
	});

	it('refuses to back up when the checkpoint cannot complete', () => {
		const file = tempFile();
		const first = createDb(file);
		backupAndMigrate(first.sqlite, first.db, file);
		first.sqlite.exec('DELETE FROM __drizzle_migrations');

		// A second connection parked in a read transaction keeps TRUNCATE from
		// folding the WAL away, which is exactly the torn-backup scenario.
		const reader = new Database(file);
		reader.exec('BEGIN');
		reader.prepare('SELECT count(*) FROM users').get();

		// The reader's open transaction is what makes the checkpoint busy; the
		// retry floor only adds latency to a result that cannot change.
		first.sqlite.pragma('busy_timeout = 0');

		expect(() => backupIfPending(first.sqlite, file)).toThrow(/checkpoint could not complete/);

		reader.exec('ROLLBACK');
		reader.close();
		first.sqlite.close();
	});
});
