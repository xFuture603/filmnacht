import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { applyMigrations, createDb, MIGRATIONS_FOLDER } from './client';

const dirs: string[] = [];

afterEach(() => {
	for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function tempDbFile(): string {
	const dir = mkdtempSync(join(tmpdir(), 'filmnacht-db-'));
	dirs.push(dir);
	return join(dir, 'filmnacht.db');
}

/**
 * A migrations folder that stops at `lastIdx` — the project as it shipped at
 * that point, and the state any real deployment upgrading past it is coming
 * from. Built from the real journal and .sql files rather than hand-written,
 * so it can't drift from what's actually shipped.
 */
function migrationsFolderThrough(lastIdx: number): string {
	const dir = mkdtempSync(join(tmpdir(), 'filmnacht-migrations-'));
	dirs.push(dir);
	mkdirSync(join(dir, 'meta'), { recursive: true });
	const journal = JSON.parse(
		readFileSync(join(MIGRATIONS_FOLDER, 'meta', '_journal.json'), 'utf8')
	) as { entries: { idx: number; tag: string }[] };
	journal.entries = journal.entries.filter((entry) => entry.idx <= lastIdx);
	writeFileSync(join(dir, 'meta', '_journal.json'), JSON.stringify(journal, null, 2));
	for (const entry of journal.entries) {
		copyFileSync(join(MIGRATIONS_FOLDER, `${entry.tag}.sql`), join(dir, `${entry.tag}.sql`));
	}
	return dir;
}

function migrationsFolderThrough0001(): string {
	return migrationsFolderThrough(1);
}

describe('applyMigrations, against a populated database (Ruling R2)', () => {
	it('survives a rebuild migration whose old table is still referenced by another FK, and leaves foreign_keys ON', () => {
		const file = tempDbFile();
		const { sqlite, db } = createDb(file);
		applyMigrations(db, migrationsFolderThrough0001());

		// A user, group, movie, suggestion, and a movie_night referencing that
		// suggestion — the exact shape a real deployment has once nights exist,
		// and the shape that exposes 0002's rebuild-vs-FK bug: SQLite can't ALTER
		// a foreign key in place, so 0002 rebuilds `suggestions` (create
		// __new_suggestions, copy rows, DROP TABLE suggestions, rename), and that
		// DROP fails while `movie_nights.suggestion_id` still points at it.
		const now = Math.floor(Date.now() / 1000);
		sqlite
			.prepare(
				`INSERT INTO users (id, display_name, username, password_hash, login_token_hash, is_admin, created_at)
				 VALUES (?, ?, ?, ?, ?, 0, ?)`
			)
			.run('u1', 'Ada', 'ada', 'x', 'h1', now);
		sqlite
			.prepare(
				`INSERT INTO groups (id, name, owner_id, settings, created_at) VALUES (?, ?, ?, ?, ?)`
			)
			.run('g1', 'Filmnacht', 'u1', '{}', now);
		sqlite.prepare(`INSERT INTO movies (id, title) VALUES (?, ?)`).run('m1', 'Dune');
		sqlite
			.prepare(
				`INSERT INTO suggestions (id, group_id, movie_id, suggested_by, dedupe_key, status, created_at)
				 VALUES (?, ?, ?, ?, ?, 'open', ?)`
			)
			.run('s1', 'g1', 'm1', 'u1', 'dune-2021', now);
		sqlite
			.prepare(
				`INSERT INTO movie_nights (id, group_id, scheduled_at, suggestion_id, status, created_at)
				 VALUES (?, ?, ?, ?, 'scheduled', ?)`
			)
			.run('n1', 'g1', now, 's1', now);

		// The real, full migration set (0000-0002) on the same connection —
		// exactly what backupAndMigrate does on an existing deployment upgrading
		// past this task. Without the foreign_keys=OFF toggle in applyMigrations,
		// this throws "FOREIGN KEY constraint failed" on the DROP TABLE above.
		expect(() => applyMigrations(db)).not.toThrow();

		expect(
			sqlite.prepare('SELECT id, suggested_by FROM suggestions WHERE id = ?').get('s1')
		).toEqual({ id: 's1', suggested_by: 'u1' });
		expect(
			sqlite.prepare('SELECT id, suggestion_id FROM movie_nights WHERE id = ?').get('n1')
		).toEqual({ id: 'n1', suggestion_id: 's1' });

		// applyMigrations turns enforcement off for the rebuild; every other
		// caller in this codebase (createDb, and thus every route and test)
		// assumes it comes back on.
		expect(sqlite.pragma('foreign_keys', { simple: true })).toBe(1);
		expect(sqlite.pragma('foreign_key_check')).toEqual([]);

		sqlite.close();
	});
});

/**
 * A minimal, self-contained migrations folder — independent of the project's
 * real schema — whose second migration inserts a row with a dangling foreign
 * key. `applyMigrations` turns enforcement off around `migrate()`, so SQLite
 * lets that INSERT through without complaint (a genuinely broken migration
 * would do exactly this); the point of the folder is to hand
 * `foreign_key_check` a real violation to catch afterwards.
 */
function migrationsFolderWithOrphanRow(): string {
	const dir = mkdtempSync(join(tmpdir(), 'filmnacht-fk-violation-'));
	dirs.push(dir);
	mkdirSync(join(dir, 'meta'), { recursive: true });
	writeFileSync(
		join(dir, '0000_init.sql'),
		'CREATE TABLE parent (id INTEGER PRIMARY KEY);\n' +
			'--> statement-breakpoint\n' +
			'CREATE TABLE child (id INTEGER PRIMARY KEY, parent_id INTEGER REFERENCES parent(id));'
	);
	writeFileSync(join(dir, '0001_orphan.sql'), 'INSERT INTO child (id, parent_id) VALUES (1, 999);');
	writeFileSync(
		join(dir, 'meta', '_journal.json'),
		JSON.stringify({
			version: '7',
			dialect: 'sqlite',
			entries: [
				{ idx: 0, version: '6', when: 1, tag: '0000_init', breakpoints: true },
				{ idx: 1, version: '6', when: 2, tag: '0001_orphan', breakpoints: true }
			]
		})
	);
	return dir;
}

describe('applyMigrations, foreign_key_check throw branch', () => {
	it('throws when a migration leaves a foreign key violation, and still restores foreign_keys = ON', () => {
		const file = tempDbFile();
		const { sqlite, db } = createDb(file);

		expect(() => applyMigrations(db, migrationsFolderWithOrphanRow())).toThrow(
			/foreign key violation/i
		);

		// The finally must have run even though applyMigrations threw.
		expect(sqlite.pragma('foreign_keys', { simple: true })).toBe(1);

		sqlite.close();
	});
});

describe('migration 0003 (ratings), against a populated database', () => {
	it('keeps every rating and night, adds revealed_at, and restricts deleting a rater', () => {
		const file = tempDbFile();
		const { sqlite, db } = createDb(file);
		applyMigrations(db, migrationsFolderThrough(2));
		sqlite.exec(`
			INSERT INTO users (id, username, display_name, password_hash, login_token_hash, is_admin, created_at)
				VALUES ('u1', 'ada', 'Ada', 'x', 'h1', 0, 0),
				       ('u2', 'grace', 'Grace', 'x', 'h2', 0, 0);
			-- Grace owns the group, so the only row referencing Ada is her rating:
			-- the DELETE below can only be refused by the ratings foreign key.
			INSERT INTO groups (id, name, owner_id, settings, created_at)
				VALUES ('g1', 'G', 'u2', '{}', 0);
			INSERT INTO movie_nights (id, group_id, scheduled_at, status, created_at)
				VALUES ('n1', 'g1', 0, 'watched', 0);
			INSERT INTO ratings (id, movie_night_id, user_id, score_x2, comment, created_at)
				VALUES ('r1', 'n1', 'u1', 15, 'good', 0);
		`);

		applyMigrations(db);

		expect(sqlite.prepare('SELECT score_x2, comment FROM ratings').all()).toEqual([
			{ score_x2: 15, comment: 'good' }
		]);
		expect(sqlite.prepare('SELECT revealed_at FROM movie_nights').get()).toEqual({
			revealed_at: null
		});
		expect(() => sqlite.prepare("DELETE FROM users WHERE id = 'u1'").run()).toThrow(/FOREIGN KEY/);
	});
});
