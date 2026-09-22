import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { copyFileSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
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

type Journal = { entries: { idx: number; tag: string }[] };

function journal(folder: string): Journal {
	const path = join(folder, 'meta', '_journal.json');
	try {
		return JSON.parse(readFileSync(path, 'utf8'));
	} catch (cause) {
		throw new Error(
			`Cannot read the migration journal at ${path}. Is the drizzle/ folder present ` +
				`in this deployment? It is read at runtime, not only at build time.`,
			{ cause }
		);
	}
}

function appliedCount(sqlite: Database.Database): number {
	const table = sqlite
		.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='__drizzle_migrations'`)
		.get();
	if (!table) return 0;
	const row = sqlite.prepare('SELECT count(*) AS n FROM __drizzle_migrations').get() as {
		n: number;
	};
	return row.n;
}

/**
 * Whether this database holds anything worth losing. Deliberately not "has it
 * recorded migrations": a database whose migration bookkeeping is missing or
 * reset is precisely the one whose data is most at risk.
 */
function hasTables(sqlite: Database.Database): boolean {
	return !!sqlite
		.prepare(`SELECT 1 FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' LIMIT 1`)
		.get();
}

/**
 * Copies the database aside before applying anything, so a bad migration at 2am
 * is recoverable rather than terminal (PRD §11). Runs whether or not the
 * operator remembered the documented backup command.
 */
export function backupIfPending(
	sqlite: Database.Database,
	file: string,
	folder = MIGRATIONS_FOLDER
): string | null {
	const entries = journal(folder).entries;
	const pending = entries.length - appliedCount(sqlite);
	if (pending <= 0 || file === ':memory:') return null;
	if (!hasTables(sqlite)) return null; // brand-new instance: nothing to lose

	// TRUNCATE folds the WAL back into the main file, so a plain copy is a
	// complete database. This is sound ONLY single-connection at startup: with a
	// concurrent reader or writer the checkpoint can come back busy and leave the
	// WAL partially folded, and the copy would then silently miss the most recent
	// commits. Do not reuse this as an on-demand backup endpoint without
	// revisiting that.
	const [checkpoint] = sqlite.pragma('wal_checkpoint(TRUNCATE)') as [
		{ busy: number; log: number; checkpointed: number }
	];
	if (checkpoint.busy !== 0) {
		throw new Error(
			'Refusing to migrate: the pre-migration WAL checkpoint could not complete ' +
				'(another connection holds the database), so the backup would be incomplete.'
		);
	}
	const backup = `${file}.pre-${entries[entries.length - 1].tag}.bak`;
	copyFileSync(file, backup);
	return backup;
}

export function backupAndMigrate(
	sqlite: Database.Database,
	db: DB,
	file: string,
	folder = MIGRATIONS_FOLDER
): string | null {
	const backup = backupIfPending(sqlite, file, folder);
	applyMigrations(db, folder);
	return backup;
}
