import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import * as schema from './schema';

export const MIGRATIONS_FOLDER = 'drizzle';

export function createDb(file: string) {
	if (file !== ':memory:') mkdirSync(dirname(file), { recursive: true });
	const sqlite = new Database(file);
	sqlite.pragma('journal_mode = WAL');
	sqlite.pragma('foreign_keys = ON');
	sqlite.pragma('busy_timeout = 5000');
	return { sqlite, db: drizzle(sqlite, { schema }) };
}

export type DB = ReturnType<typeof createDb>['db'];

export function applyMigrations(db: DB, folder = MIGRATIONS_FOLDER): void {
	migrate(db, { migrationsFolder: folder });
}
