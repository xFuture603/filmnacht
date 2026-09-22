# filmnacht — Plan 1: Foundation & Access Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A running filmnacht instance where the first visitor becomes the instance admin, creates a group, sends an invite link, a second person joins through it and gets back in on a second device via their personal login link — in English or German.

**Architecture:** One SvelteKit app, one SQLite file. Server logic lives in `src/lib/server/**` as plain functions that take the Drizzle `db` handle as their first argument, so every one of them is unit-testable against an in-memory database with no mocking. The DB singleton and `$env` access are confined to a single untested module. Auth is a 128-bit bearer token → SHA-256 lookup → server-side session row, roughly 60 lines total.

**Tech Stack:** SvelteKit 2 / Svelte 5, Vite 8, TypeScript, better-sqlite3 13 + Drizzle ORM 0.45, Tailwind 4 + daisyUI 5, Vitest 5, adapter-node 5.

**Spec:** `prd.md` (sections 3, 4, 9, 10, 11, 12)

## Global Constraints

- Node 24. Package manager: npm.
- Pinned floors (verified on npm 2026-09-21): `svelte@^5.57`, `@sveltejs/kit@^2.70`, `@sveltejs/adapter-node@^5.5`, `vite@^8.3`, `vitest@^5.0`, `drizzle-orm@^0.45.3`, `drizzle-kit@^0.31.11`, `better-sqlite3@^13.0.3`, `tailwindcss@^4.3`, `daisyui@^5.7`.
- **English is the source language in code** (PRD §12): identifiers, message keys and default strings are English. German ships as a translation file.
- All timestamps stored in UTC. In SQLite they are integer unix seconds via Drizzle `{ mode: 'timestamp' }`.
- Rating scores are integers 2–20 (`score_x2`), never floats (PRD §7). Not used in this plan, but the column is created here.
- Tokens (invite, login) carry **at least 128 bits of entropy** and are stored **hashed** (PRD §12).
- Session cookies: HTTP-only, `SameSite=Lax`, `secure` outside dev, 30-day sliding expiry (PRD §9).
- Every group query is checked server-side against membership. A non-member gets **404, not 403**, so a guessed ID is not confirmed (PRD §12).
- No new runtime dependency beyond the list above without saying why in the commit message.
- Server modules under test must not import `$env/*`. Env access lives only in `src/lib/server/db/index.ts`.

## Stack decisions this plan locks in (and why they differ from a naive reading of the PRD)

1. **better-sqlite3, not `node:sqlite`.** Verified: `drizzle-orm@0.45.3` ships no `node-sqlite` entrypoint (only `better-sqlite3`, `bun-sqlite`, `libsql`, `sqlite-proxy`, `expo-sqlite`, `op-sqlite`, `durable-sqlite`). The `sv add drizzle` CLI offers a `node-sqlite` client option that the installed ORM cannot back. better-sqlite3 13.0.3 loads on Node 24 and ships prebuilt binaries.
2. **Docker base must be glibc (`node:24-bookworm-slim`), never Alpine.** better-sqlite3 has no musl prebuild; on Alpine it compiles from source and needs a toolchain in the image. This is exactly the "failure you cannot debug on somebody else's Synology" the PRD warns about (§11). Recorded here; enforced in Plan 5.
3. **Hand-rolled i18n, not Paraglide.** PRD §12 asks for flat JSON files and ~30 lines. Task 2 is 30 lines. No build step, no CLI.
4. **Deviation — the `invite` token is stored hashed.** PRD §10 lists it as `token` while listing `login_token_hash` hashed. Redemption is a lookup either way, so hashing costs nothing and removes a live credential from the database.
5. **Deviation — the personal login link is revealed by regenerating it.** PRD §9 wants it "shown in the profile behind a copy button"; PRD §10 stores only `login_token_hash`. Both cannot hold. Resolution: the profile has one **Reveal login link** action that generates a fresh token, shows it once with a copy button, and invalidates the previous one — which is also the "revoke and regenerate" §9 asks for. Already-signed-in devices keep their session cookie and are unaffected.
6. **`users.is_admin` added to the §10 field list.** PRD §11 makes the first account the instance admin and §3 gives that role rights; nothing in §10 stored it.

---

## File Structure

| File | Responsibility |
| --- | --- |
| `src/lib/i18n/index.ts` | `t()`, `resolveLocale()`, locale list. Pure, no DB, no SvelteKit imports. |
| `src/lib/i18n/en.json`, `de.json` | Flat key → string dictionaries. |
| `src/lib/server/db/schema.ts` | The whole MVP schema (PRD §10). Written once, here, so later plans add rows not migrations. |
| `src/lib/server/db/client.ts` | `createDb(file)` + `backupAndMigrate()`. Pure of env, importable by tests. |
| `src/lib/server/db/index.ts` | The app singleton: reads `$env`, opens the DB, migrates at startup. Never imported by a test. |
| `src/lib/server/auth/tokens.ts` | `generateToken()`, `hashToken()`. |
| `src/lib/server/auth/session.ts` | Session create/validate/delete + cookie helpers. |
| `src/lib/server/rate-limit.ts` | In-memory fixed-window limiter. |
| `src/lib/server/settings.ts` | Instance-level `setting` rows, `isSetupComplete()`. |
| `src/lib/server/groups.ts` | `createGroup()`, `requireMember()`, `listGroupsFor()`. |
| `src/lib/server/invites.ts` | `createInvite()`, `redeemInvite()`. |
| `src/hooks.server.ts` | Locale resolution, session → `locals.user`, setup guard. |
| `src/routes/**` | Pages and form actions only. No business logic. |

---

## Task 1: Project scaffold and toolchain

**Files:**
- Create: the SvelteKit project in the repo root, `src/app.css`, `.env.example`, `.gitignore`
- Modify: `vite.config.ts`, `svelte.config.js`, `src/app.html`, `package.json`

**Interfaces:**
- Consumes: nothing.
- Produces: `npm run dev|build|test|lint|check`; the `$lib` alias; Tailwind 4 + daisyUI 5 available to every component.

- [ ] **Step 1: Initialise git and scaffold**

The repo is not yet a git repository and holds only `prd.md` and `docs/`.

```bash
git init
npx sv create . --template minimal --types ts --no-add-ons --no-install --no-dir-check
npx sv add --no-install eslint prettier
```

- [ ] **Step 2: Install dependencies**

Do not use `sv add drizzle` (its `node-sqlite` client option is not backed by the released ORM — see Stack decisions) and do not use `sv add tailwindcss` (it scaffolds a v3-shaped config). Install directly:

```bash
npm i drizzle-orm@^0.45.3 better-sqlite3@^13.0.3
npm i -D @sveltejs/adapter-node@^5.5 drizzle-kit@^0.31.11 @types/better-sqlite3 \
         tailwindcss@^4.3 @tailwindcss/vite@^4.3 daisyui@^5.7 vitest@^5.0
```

- [ ] **Step 3: Wire the adapter**

`svelte.config.js`:

```js
import adapter from '@sveltejs/adapter-node';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

export default {
	preprocess: vitePreprocess(),
	kit: { adapter: adapter() }
};
```

- [ ] **Step 4: Wire Tailwind, daisyUI and Vitest**

`vite.config.ts` — note the import comes from `vitest/config`, which is what types the `test` key:

```ts
import { sveltekit } from '@sveltejs/kit/vite';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vitest/config';

export default defineConfig({
	plugins: [tailwindcss(), sveltekit()],
	test: {
		include: ['src/**/*.test.ts'],
		environment: 'node'
	}
});
```

`src/app.css` — Tailwind 4 is configured in CSS, there is no `tailwind.config.js`:

```css
@import 'tailwindcss';
@plugin 'daisyui';
```

`src/routes/+layout.svelte`:

```svelte
<script lang="ts">
	import '../app.css';
	let { children } = $props();
</script>

{@render children()}
```

- [ ] **Step 5: Prepare `app.html` for the locale attribute**

`src/app.html` — replace the opening `<html>` tag so Task 6 can stamp the language in:

```html
<html lang="%lang%">
```

- [ ] **Step 6: Add npm scripts**

In `package.json`, ensure the `scripts` block contains:

```json
{
	"dev": "vite dev",
	"build": "vite build",
	"preview": "vite preview",
	"check": "svelte-kit sync && svelte-check --tsconfig ./tsconfig.json",
	"lint": "prettier --check . && eslint .",
	"format": "prettier --write .",
	"test": "vitest run",
	"test:watch": "vitest",
	"db:generate": "drizzle-kit generate"
}
```

- [ ] **Step 7: Add `.env.example` and `.gitignore` entries**

`.env.example`:

```bash
# Path to the SQLite database file. Must be on LOCAL disk — SQLite locking is
# not safe over NFS or SMB (prd.md §11).
DATABASE_PATH=data/filmnacht.db

# Public origin of this instance, e.g. https://filmnacht.example.org
# adapter-node needs this for CSRF origin checks behind a reverse proxy.
ORIGIN=http://localhost:3000
```

Append to `.gitignore`:

```
data/
.env
drizzle/*.bak
```

- [ ] **Step 8: Verify the toolchain and commit**

Run: `npm run lint && npm run check && npm run build`
Expected: all three clean; build writes `build/`. Do not run `npm run test` yet — `vitest run` exits 1 when no test files match, and the first one arrives in Task 2.

```bash
git add -A
git commit -m "chore: scaffold SvelteKit + Tailwind 4 + daisyUI + Vitest"
```

---

## Task 2: Internationalisation core

**Files:**
- Create: `src/lib/i18n/index.ts`, `src/lib/i18n/en.json`, `src/lib/i18n/de.json`, `src/lib/i18n/i18n.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `type Locale = 'en' | 'de'`
  - `locales: readonly Locale[]`
  - `t(locale: Locale, key: string, params?: Record<string, string | number>): string`
  - `resolveLocale(acceptLanguage: string | null, cookie?: string | null): Locale`

- [ ] **Step 1: Write the failing test**

`src/lib/i18n/i18n.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { resolveLocale, t } from './index';

describe('t', () => {
	it('returns the string for the locale', () => {
		expect(t('en', 'nav.groups')).toBe('Groups');
		expect(t('de', 'nav.groups')).toBe('Gruppen');
	});

	it('falls back to English when a translation is missing', () => {
		expect(t('de', 'test.only_in_english')).toBe('Only in English');
	});

	it('returns the key itself when no dictionary has it', () => {
		expect(t('en', 'nope.not.here')).toBe('nope.not.here');
	});

	it('interpolates named parameters', () => {
		expect(t('en', 'test.greeting', { name: 'Ada' })).toBe('Hello Ada');
	});

	it('leaves unknown placeholders intact rather than printing undefined', () => {
		expect(t('en', 'test.greeting')).toBe('Hello {name}');
	});

	it('leaves a placeholder intact when params omits its key', () => {
		expect(t('en', 'test.greeting', { })).toBe('Hello {name}');
	});
});

describe('resolveLocale', () => {
	it('prefers a valid cookie over the header', () => {
		expect(resolveLocale('en-US,en;q=0.9', 'de')).toBe('de');
	});

	it('ignores an unsupported cookie', () => {
		expect(resolveLocale('de-DE,de;q=0.9', 'fr')).toBe('de');
	});

	it('reads the first supported tag from Accept-Language', () => {
		expect(resolveLocale('fr-FR,fr;q=0.9,de;q=0.8,en;q=0.7')).toBe('de');
	});

	it('defaults to English', () => {
		expect(resolveLocale(null)).toBe('en');
		expect(resolveLocale('fr-FR,fr;q=0.9')).toBe('en');
	});

	it('ranks by quality value, not by position in the header', () => {
		expect(resolveLocale('en;q=0.5,de;q=0.9')).toBe('de');
	});

	it('treats q=0 as "not acceptable" rather than as a weak preference', () => {
		expect(resolveLocale('de;q=0,en')).toBe('en');
	});
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/lib/i18n/i18n.test.ts`
Expected: FAIL — cannot resolve `./index`.

- [ ] **Step 3: Write the dictionaries**

`src/lib/i18n/en.json`:

```json
{
	"app.name": "filmnacht",
	"nav.groups": "Groups",
	"nav.profile": "Profile",
	"nav.language": "Language",
	"common.save": "Save",
	"common.cancel": "Cancel",
	"common.copy": "Copy",
	"common.copied": "Copied",
	"test.greeting": "Hello {name}",
	"test.only_in_english": "Only in English"
}
```

`src/lib/i18n/de.json`:

```json
{
	"app.name": "filmnacht",
	"nav.groups": "Gruppen",
	"nav.profile": "Profil",
	"nav.language": "Sprache",
	"common.save": "Speichern",
	"common.cancel": "Abbrechen",
	"common.copy": "Kopieren",
	"common.copied": "Kopiert"
}
```

- [ ] **Step 4: Write the implementation**

`src/lib/i18n/index.ts`:

```ts
import de from './de.json';
import en from './en.json';

export const locales = ['en', 'de'] as const;
export type Locale = (typeof locales)[number];

const dictionaries: Record<Locale, Record<string, string>> = { en, de };

function isLocale(value: unknown): value is Locale {
	return typeof value === 'string' && (locales as readonly string[]).includes(value);
}

export function t(locale: Locale, key: string, params?: Record<string, string | number>): string {
	const template = dictionaries[locale][key] ?? dictionaries.en[key] ?? key;
	if (!params) return template;
	return template.replace(/\{(\w+)\}/g, (match, name) =>
		name in params ? String(params[name]) : match
	);
}

export function resolveLocale(acceptLanguage: string | null, cookie?: string | null): Locale {
	if (isLocale(cookie)) return cookie;
	const ranked = (acceptLanguage ?? '')
		.split(',')
		.map((part) => {
			const [tag, ...params] = part.split(';');
			const q = params.find((p) => p.trim().startsWith('q='))?.split('=')[1];
			const weight = q === undefined || !Number.isFinite(Number(q)) ? 1 : Number(q);
			return { tag: tag.trim().slice(0, 2).toLowerCase(), weight };
		})
		// q=0 means "not acceptable", so it is a filter, not just a low rank.
		.filter((entry) => isLocale(entry.tag) && entry.weight > 0)
		.sort((a, b) => b.weight - a.weight);
	// Array sort is stable, so equal weights keep the header's own order.
	return ranked.length ? (ranked[0].tag as Locale) : 'en';
}
```

`tsconfig.json` must allow the JSON imports — confirm `"resolveJsonModule": true` is set (the SvelteKit base config sets it; add it to `compilerOptions` if `npm run check` complains).

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run src/lib/i18n/i18n.test.ts`
Expected: PASS, 12 tests.

- [ ] **Step 6: Commit**

```bash
git add src/lib/i18n tsconfig.json
git commit -m "feat(i18n): flat-JSON translations with English fallback"
```

---

## Task 3: Database schema and client

**Files:**
- Create: `src/lib/server/db/schema.ts`, `src/lib/server/db/client.ts`, `src/lib/server/db/client.test.ts`, `drizzle.config.ts`
- Generated: `drizzle/0000_*.sql`, `drizzle/meta/_journal.json`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `createDb(file: string): { sqlite: Database.Database; db: DB }`
  - `type DB` — the Drizzle handle every server function takes as its first argument
  - `applyMigrations(db: DB, folder?: string): void`
  - Tables: `users, identities, sessions, groups, memberships, invites, movies, suggestions, movieNights, attendance, ratings, settings`
  - `DEFAULT_GROUP_SETTINGS: GroupSettings`

- [ ] **Step 1: Write the failing test**

`src/lib/server/db/client.test.ts`:

```ts
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { applyMigrations, createDb } from './client';
import { DEFAULT_GROUP_SETTINGS, groups, users } from './schema';

function testDb() {
	const { db } = createDb(':memory:');
	applyMigrations(db);
	return db;
}

describe('createDb', () => {
	it('enables foreign key enforcement', () => {
		const { sqlite } = createDb(':memory:');
		expect(sqlite.pragma('foreign_keys', { simple: true })).toBe(1);
	});

	it('round-trips a user with a generated id and timestamp', () => {
		const db = testDb();
		db.insert(users).values({ displayName: 'Ada', loginTokenHash: 'hash-a' }).run();
		const row = db.select().from(users).where(eq(users.displayName, 'Ada')).get();
		expect(row?.id).toMatch(/^[0-9a-f-]{36}$/);
		expect(row?.createdAt).toBeInstanceOf(Date);
		expect(row?.isAdmin).toBe(false);
		expect(row?.email).toBeNull();
	});

	it('rejects a second user with the same login token hash', () => {
		const db = testDb();
		db.insert(users).values({ displayName: 'Ada', loginTokenHash: 'dup' }).run();
		expect(() =>
			db.insert(users).values({ displayName: 'Grace', loginTokenHash: 'dup' }).run()
		).toThrow();
	});

	it('stores group settings as JSON and returns them as an object', () => {
		const db = testDb();
		db.insert(users).values({ id: 'u1', displayName: 'Ada', loginTokenHash: 'h' }).run();
		db.insert(groups).values({ name: 'Movie Club', ownerId: 'u1' }).run();
		const group = db.select().from(groups).get();
		expect(group?.settings).toEqual(DEFAULT_GROUP_SETTINGS);
		expect(group?.settings.maxOpenSuggestions).toBe(3);
	});

	it('rejects a group whose owner does not exist', () => {
		const db = testDb();
		expect(() => db.insert(groups).values({ name: 'Ghosts', ownerId: 'nobody' }).run()).toThrow();
	});
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/lib/server/db/client.test.ts`
Expected: FAIL — cannot resolve `./client`.

- [ ] **Step 3: Write the schema**

`src/lib/server/db/schema.ts` — the complete MVP schema from PRD §10. Later plans add rows to these tables, not columns:

```ts
import { integer, real, sqliteTable, text, unique } from 'drizzle-orm/sqlite-core';

const uuid = () =>
	text('id')
		.primaryKey()
		.$defaultFn(() => crypto.randomUUID());

const createdAt = () =>
	integer('created_at', { mode: 'timestamp' })
		.notNull()
		.$defaultFn(() => new Date());

/** PRD §4 group settings table. Stored as JSON so adding one costs no migration. */
export type GroupSettings = {
	maxOpenSuggestions: number;
	drawMode: 'fairness' | 'uniform';
	resultVisible: 'immediately' | 'on_night';
	nightEndsAfterMinutes: number;
	ratingWindowDays: number;
	repeatDrawnFilms: boolean;
};

export const DEFAULT_GROUP_SETTINGS: GroupSettings = {
	maxOpenSuggestions: 3,
	drawMode: 'fairness',
	resultVisible: 'immediately',
	nightEndsAfterMinutes: 180,
	ratingWindowDays: 7,
	repeatDrawnFilms: false
};

export const users = sqliteTable('users', {
	id: uuid(),
	displayName: text('display_name').notNull(),
	avatarUrl: text('avatar_url'),
	/** Unused in the MVP (PRD §9). Nullable until SMTP arrives in v1.0. */
	email: text('email'),
	loginTokenHash: text('login_token_hash').notNull().unique(),
	/** PRD §11: the first account created by the setup screen. */
	isAdmin: integer('is_admin', { mode: 'boolean' }).notNull().default(false),
	createdAt: createdAt()
});

/** Empty until OIDC lands in v2 (PRD §9). Created now so that is an insert, not a migration. */
export const identities = sqliteTable(
	'identities',
	{
		id: uuid(),
		userId: text('user_id')
			.notNull()
			.references(() => users.id, { onDelete: 'cascade' }),
		provider: text('provider').notNull(),
		subject: text('subject').notNull(),
		createdAt: createdAt()
	},
	(table) => [unique('identities_provider_subject').on(table.provider, table.subject)]
);

/** `id` is the SHA-256 of the cookie token, never the token itself (PRD §12). */
export const sessions = sqliteTable('sessions', {
	id: text('id').primaryKey(),
	userId: text('user_id')
		.notNull()
		.references(() => users.id, { onDelete: 'cascade' }),
	createdAt: createdAt(),
	expiresAt: integer('expires_at', { mode: 'timestamp' }).notNull()
});

export const groups = sqliteTable('groups', {
	id: uuid(),
	name: text('name').notNull(),
	emoji: text('emoji'),
	ownerId: text('owner_id')
		.notNull()
		.references(() => users.id),
	settings: text('settings', { mode: 'json' })
		.$type<GroupSettings>()
		.notNull()
		.$defaultFn(() => DEFAULT_GROUP_SETTINGS),
	createdAt: createdAt()
});

export const memberships = sqliteTable(
	'memberships',
	{
		id: uuid(),
		userId: text('user_id')
			.notNull()
			.references(() => users.id, { onDelete: 'cascade' }),
		groupId: text('group_id')
			.notNull()
			.references(() => groups.id, { onDelete: 'cascade' }),
		role: text('role', { enum: ['owner', 'member'] })
			.notNull()
			.default('member'),
		joinedAt: integer('joined_at', { mode: 'timestamp' })
			.notNull()
			.$defaultFn(() => new Date()),
		/** Set on leaving. History stays, access does not (PRD §4). */
		leftAt: integer('left_at', { mode: 'timestamp' })
	},
	(table) => [unique('memberships_user_group').on(table.userId, table.groupId)]
);

export const invites = sqliteTable('invites', {
	/** SHA-256 of the invite token — see Stack decisions, deviation 4. */
	tokenHash: text('token_hash').primaryKey(),
	groupId: text('group_id')
		.notNull()
		.references(() => groups.id, { onDelete: 'cascade' }),
	createdBy: text('created_by')
		.notNull()
		.references(() => users.id),
	expiresAt: integer('expires_at', { mode: 'timestamp' }).notNull(),
	maxUses: integer('max_uses'),
	uses: integer('uses').notNull().default(0),
	createdAt: createdAt()
});

/** Global across groups: one row per film, saving TMDB calls (PRD §10). */
export const movies = sqliteTable('movies', {
	id: uuid(),
	tmdbId: integer('tmdb_id').unique(),
	title: text('title').notNull(),
	year: integer('year'),
	posterUrl: text('poster_url'),
	runtime: integer('runtime'),
	genres: text('genres', { mode: 'json' }).$type<string[]>(),
	tmdbRating: real('tmdb_rating'),
	cachedAt: integer('cached_at', { mode: 'timestamp' })
});

export const suggestions = sqliteTable(
	'suggestions',
	{
		id: uuid(),
		groupId: text('group_id')
			.notNull()
			.references(() => groups.id, { onDelete: 'cascade' }),
		movieId: text('movie_id')
			.notNull()
			.references(() => movies.id),
		/** Null for the v1.0 wildcard pick, which belongs to nobody (PRD §10). */
		suggestedBy: text('suggested_by').references(() => users.id),
		dedupeKey: text('dedupe_key').notNull(),
		note: text('note'),
		status: text('status', { enum: ['open', 'drawn', 'withdrawn'] })
			.notNull()
			.default('open'),
		createdAt: createdAt()
	},
	(table) => [unique('suggestions_group_dedupe').on(table.groupId, table.dedupeKey)]
);

export const movieNights = sqliteTable('movie_nights', {
	id: uuid(),
	groupId: text('group_id')
		.notNull()
		.references(() => groups.id, { onDelete: 'cascade' }),
	scheduledAt: integer('scheduled_at', { mode: 'timestamp' }).notNull(),
	location: text('location'),
	suggestionId: text('suggestion_id').references(() => suggestions.id),
	drawnAt: integer('drawn_at', { mode: 'timestamp' }),
	drawSeed: text('draw_seed'),
	/** Append-only: a re-draw adds an entry, it never overwrites one (PRD §6). */
	drawLog: text('draw_log', { mode: 'json' }).$type<unknown[]>(),
	status: text('status', { enum: ['scheduled', 'drawn', 'watched', 'cancelled'] })
		.notNull()
		.default('scheduled'),
	createdAt: createdAt()
});

export const attendance = sqliteTable(
	'attendance',
	{
		id: uuid(),
		movieNightId: text('movie_night_id')
			.notNull()
			.references(() => movieNights.id, { onDelete: 'cascade' }),
		userId: text('user_id')
			.notNull()
			.references(() => users.id, { onDelete: 'cascade' }),
		response: text('response', { enum: ['yes', 'no', 'maybe'] }).notNull()
	},
	(table) => [unique('attendance_night_user').on(table.movieNightId, table.userId)]
);

/** Hangs off the night, not the movie, so the same film can be rated again in two years. */
export const ratings = sqliteTable(
	'ratings',
	{
		id: uuid(),
		movieNightId: text('movie_night_id')
			.notNull()
			.references(() => movieNights.id, { onDelete: 'cascade' }),
		userId: text('user_id').references(() => users.id, { onDelete: 'set null' }),
		/** 2–20: the 1–10 half-step score doubled. Never a float (PRD §7). */
		scoreX2: integer('score_x2').notNull(),
		comment: text('comment'),
		createdAt: createdAt()
	},
	(table) => [unique('ratings_night_user').on(table.movieNightId, table.userId)]
);

/** Instance-level configuration the admin edits in the UI, timezone first (PRD §10). */
export const settings = sqliteTable('settings', {
	key: text('key').primaryKey(),
	value: text('value').notNull()
});
```

- [ ] **Step 4: Write the client**

`src/lib/server/db/client.ts`:

```ts
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
```

- [ ] **Step 5: Write the drizzle-kit config and generate the migration**

`drizzle.config.ts`:

```ts
import { defineConfig } from 'drizzle-kit';

export default defineConfig({
	schema: './src/lib/server/db/schema.ts',
	out: './drizzle',
	dialect: 'sqlite',
	dbCredentials: { url: process.env.DATABASE_PATH ?? 'data/filmnacht.db' }
});
```

Run: `npm run db:generate`
Expected: `drizzle/0000_<name>.sql` and `drizzle/meta/_journal.json` are created. Read the SQL and confirm it contains `CREATE TABLE` for all twelve tables.

- [ ] **Step 6: Run the test to verify it passes**

Run: `npx vitest run src/lib/server/db/client.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 7: Commit**

The generated `drizzle/` SQL is committed — it is the migration history, not a build artefact.

```bash
git add src/lib/server/db drizzle.config.ts drizzle package.json
git commit -m "feat(db): MVP schema, SQLite client and initial migration"
```

---

## Task 4: Automatic migration with pre-migration backup

**Files:**
- Create: `src/lib/server/db/index.ts`, `src/lib/server/db/backup.test.ts`
- Modify: `src/lib/server/db/client.ts`

**Interfaces:**
- Consumes: `createDb`, `applyMigrations`, `MIGRATIONS_FOLDER` (Task 3).
- Produces:
  - `backupIfPending(sqlite: Database.Database, file: string, folder?: string): string | null` — returns the backup path written, or `null` if no backup was warranted
  - `backupAndMigrate(sqlite: Database.Database, db: DB, file: string, folder?: string): string | null` — `backupIfPending` then `applyMigrations`
  - `db` and `sqlite` singletons exported from `src/lib/server/db/index.ts`

- [ ] **Step 1: Write the failing test**

`src/lib/server/db/backup.test.ts`:

```ts
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
	it('does not back up a database file that did not exist yet', () => {
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
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/lib/server/db/backup.test.ts`
Expected: FAIL — `backupAndMigrate` is not exported.

- [ ] **Step 3: Implement the backup**

Append to `src/lib/server/db/client.ts`:

```ts
import { copyFileSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

type Journal = { entries: { idx: number; tag: string }[] };

function journal(folder: string): Journal {
	const path = join(folder, 'meta', '_journal.json');
	try {
		return JSON.parse(readFileSync(path, 'utf8'));
	} catch (cause) {
		// The drizzle/ folder is read at RUNTIME, so a Docker image that forgot to
		// copy it fails here — name that cause instead of a bare ENOENT stack.
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
	const row = sqlite.prepare('SELECT count(*) AS n FROM __drizzle_migrations').get() as { n: number };
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
	if (pending <= 0 || file === ':memory:' || !existsSync(file)) return null;
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
```

Add `import type Database from 'better-sqlite3';` at the top if TypeScript needs the type separately from the value import.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/lib/server/db/backup.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Write the application singleton**

`src/lib/server/db/index.ts` — the one module that touches `$env`, and the one module no test imports:

```ts
import { env } from '$env/dynamic/private';
import { backupAndMigrate, createDb } from './client';

const file = env.DATABASE_PATH || 'data/filmnacht.db';

export const { sqlite, db } = createDb(file);

const backup = backupAndMigrate(sqlite, db, file);
if (backup) console.log(`[filmnacht] database backed up to ${backup} before migrating`);

export type { DB } from './client';
```

Note for Plan 5: the `drizzle/` folder must be copied into the Docker image — `backupAndMigrate` reads it at runtime.

- [ ] **Step 6: Commit**

```bash
git add src/lib/server/db
git commit -m "feat(db): migrate at startup after an automatic pre-migration backup"
```

---

## Task 5: Tokens, sessions and rate limiting

**Files:**
- Create: `src/lib/server/auth/tokens.ts`, `src/lib/server/auth/session.ts`, `src/lib/server/auth/session.test.ts`, `src/lib/server/rate-limit.ts`, `src/lib/server/rate-limit.test.ts`

**Interfaces:**
- Consumes: `DB`, `createDb`, `applyMigrations`, `users`, `sessions` (Tasks 3–4).
- Produces:
  - `generateToken(): string` — 128 bits, base64url
  - `hashToken(token: string): string` — SHA-256 hex
  - `SESSION_COOKIE = 'filmnacht_session'`, `SESSION_TTL_MS = 30 days`
  - `createSession(db: DB, userId: string, now?: number): { token: string; expiresAt: Date }`
  - `validateSession(db: DB, token: string, now?: number): { user: SessionUser; expiresAt: Date; refreshed: boolean } | null`
  - `deleteSession(db: DB, token: string): void`
  - `type SessionUser = { id: string; displayName: string; isAdmin: boolean }`
  - `rateLimit(key: string, limit?: number, windowMs?: number, now?: number): boolean`

- [ ] **Step 1: Write the failing tests**

`src/lib/server/auth/session.test.ts`:

```ts
import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { applyMigrations, createDb, type DB } from '../db/client';
import { sessions, users } from '../db/schema';
import { generateToken, hashToken } from './tokens';
import { createSession, deleteSession, SESSION_TTL_MS, validateSession } from './session';

let db: DB;

beforeEach(() => {
	db = createDb(':memory:').db;
	applyMigrations(db);
	db.insert(users).values({ id: 'u1', displayName: 'Ada', loginTokenHash: 'h1' }).run();
});

describe('generateToken', () => {
	it('produces at least 128 bits of entropy, URL-safe', () => {
		const token = generateToken();
		expect(token).toMatch(/^[A-Za-z0-9_-]{22}$/); // 16 bytes base64url
		expect(Buffer.from(token, 'base64url')).toHaveLength(16);
	});

	it('does not repeat', () => {
		const seen = new Set(Array.from({ length: 500 }, generateToken));
		expect(seen.size).toBe(500);
	});
});

describe('createSession', () => {
	it('stores the hash, never the token itself', () => {
		const { token } = createSession(db, 'u1');
		const row = db.select().from(sessions).get();
		expect(row?.id).toBe(hashToken(token));
		expect(row?.id).not.toBe(token);
	});
});

describe('validateSession', () => {
	it('returns the user for a live token', () => {
		const { token } = createSession(db, 'u1');
		expect(validateSession(db, token)?.user).toEqual({
			id: 'u1',
			displayName: 'Ada',
			isAdmin: false
		});
	});

	it('returns null for an unknown token', () => {
		expect(validateSession(db, generateToken())).toBeNull();
	});

	it('returns null for an expired token and deletes the row', () => {
		const start = Date.UTC(2026, 0, 1);
		const { token } = createSession(db, 'u1', start);
		expect(validateSession(db, token, start + SESSION_TTL_MS + 1)).toBeNull();
		expect(db.select().from(sessions).all()).toHaveLength(0);
	});

	it('slides the expiry once the session is past its halfway point', () => {
		const start = Date.UTC(2026, 0, 1);
		const { token } = createSession(db, 'u1', start);
		const later = start + SESSION_TTL_MS * 0.6;
		const result = validateSession(db, token, later);
		expect(result?.refreshed).toBe(true);
		expect(result?.expiresAt.getTime()).toBe(later + SESSION_TTL_MS);
	});

	it('does not slide a fresh session', () => {
		const start = Date.UTC(2026, 0, 1);
		const { token } = createSession(db, 'u1', start);
		expect(validateSession(db, token, start + 1000)?.refreshed).toBe(false);
	});
});

describe('deleteSession', () => {
	it('removes the row so the token stops working', () => {
		const { token } = createSession(db, 'u1');
		deleteSession(db, token);
		expect(validateSession(db, token)).toBeNull();
	});
});

describe('cascade', () => {
	it('drops sessions when the user is deleted', () => {
		const { token } = createSession(db, 'u1');
		db.delete(users).where(eq(users.id, 'u1')).run();
		expect(validateSession(db, token)).toBeNull();
		// Without this the test passes whether or not the cascade fires, because
		// the innerJoin filters orphaned rows out anyway.
		expect(db.select().from(sessions).all()).toHaveLength(0);
	});
});
```

`src/lib/server/rate-limit.test.ts`:

```ts
import { beforeEach, describe, expect, it } from 'vitest';
import { rateLimit, resetRateLimits } from './rate-limit';

beforeEach(resetRateLimits);

describe('rateLimit', () => {
	it('allows up to the limit and then refuses', () => {
		for (let i = 0; i < 5; i++) expect(rateLimit('ip:1.2.3.4', 5, 60_000, 0)).toBe(true);
		expect(rateLimit('ip:1.2.3.4', 5, 60_000, 0)).toBe(false);
	});

	it('starts a fresh window once the old one has passed', () => {
		for (let i = 0; i < 5; i++) rateLimit('ip:1.2.3.4', 5, 60_000, 0);
		expect(rateLimit('ip:1.2.3.4', 5, 60_000, 60_001)).toBe(true);
	});

	it('counts each key separately', () => {
		for (let i = 0; i < 5; i++) rateLimit('ip:1.1.1.1', 5, 60_000, 0);
		expect(rateLimit('ip:2.2.2.2', 5, 60_000, 0)).toBe(true);
	});

	it('bounds its memory under key churn instead of growing without limit', () => {
		expect(rateLimit('victim', 1, 60_000, 0)).toBe(true);
		expect(rateLimit('victim', 1, 60_000, 0)).toBe(false);

		for (let i = 0; i < 10_001; i++) rateLimit(`flood:${i}`, 1, 60_000, 0);

		// 'victim' was evicted to keep the map bounded, so it starts fresh —
		// which is the observable consequence of the cap actually applying.
		expect(rateLimit('victim', 1, 60_000, 0)).toBe(true);
	});
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/lib/server/auth src/lib/server/rate-limit.test.ts`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement tokens**

`src/lib/server/auth/tokens.ts`:

```ts
import { createHash, randomBytes } from 'node:crypto';

/** 16 bytes = 128 bits of entropy (PRD §12), base64url so it is safe in a path. */
export function generateToken(): string {
	return randomBytes(16).toString('base64url');
}

/**
 * Tokens are full-entropy random values, not passwords, so a fast hash is the
 * right tool: there is nothing to brute-force. Lookup is by hash, so a leaked
 * database contains no usable credential.
 */
export function hashToken(token: string): string {
	return createHash('sha256').update(token).digest('hex');
}
```

- [ ] **Step 4: Implement sessions**

`src/lib/server/auth/session.ts`:

```ts
import type { Cookies } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import type { DB } from '../db/client';
import { sessions, users } from '../db/schema';
import { generateToken, hashToken } from './tokens';

export const SESSION_COOKIE = 'filmnacht_session';
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export type SessionUser = { id: string; displayName: string; isAdmin: boolean };

export function createSession(db: DB, userId: string, now = Date.now()) {
	const token = generateToken();
	const expiresAt = new Date(now + SESSION_TTL_MS);
	db.insert(sessions).values({ id: hashToken(token), userId, expiresAt }).run();
	return { token, expiresAt };
}

export function validateSession(db: DB, token: string, now = Date.now()) {
	const id = hashToken(token);
	const row = db
		.select({
			expiresAt: sessions.expiresAt,
			id: users.id,
			displayName: users.displayName,
			isAdmin: users.isAdmin
		})
		.from(sessions)
		.innerJoin(users, eq(users.id, sessions.userId))
		.where(eq(sessions.id, id))
		.get();
	if (!row) return null;

	if (row.expiresAt.getTime() <= now) {
		db.delete(sessions).where(eq(sessions.id, id)).run();
		return null;
	}

	// Sliding expiry: extend once past the halfway point, so an active user is
	// never logged out but an idle one still ages out after 30 days.
	let expiresAt = row.expiresAt;
	let refreshed = false;
	if (expiresAt.getTime() - now < SESSION_TTL_MS / 2) {
		expiresAt = new Date(now + SESSION_TTL_MS);
		db.update(sessions).set({ expiresAt }).where(eq(sessions.id, id)).run();
		refreshed = true;
	}

	const user: SessionUser = {
		id: row.id,
		displayName: row.displayName,
		isAdmin: row.isAdmin
	};
	return { user, expiresAt, refreshed };
}

export function deleteSession(db: DB, token: string): void {
	db.delete(sessions).where(eq(sessions.id, hashToken(token))).run();
}

export function setSessionCookie(
	cookies: Cookies,
	token: string,
	expiresAt: Date,
	secure: boolean
): void {
	cookies.set(SESSION_COOKIE, token, {
		path: '/',
		httpOnly: true,
		sameSite: 'lax',
		secure,
		expires: expiresAt
	});
}

export function clearSessionCookie(cookies: Cookies): void {
	cookies.delete(SESSION_COOKIE, { path: '/' });
}
```

- [ ] **Step 5: Implement rate limiting**

`src/lib/server/rate-limit.ts`:

```ts
type Window = { count: number; resetAt: number };

const windows = new Map<string, Window>();

const MAX_WINDOWS = 10_000;

/**
 * ponytail: in-process fixed window. Resets on restart and does not span
 * replicas — correct for the single-container deployment in PRD §11. Swap for a
 * shared store only if filmnacht ever runs more than one instance.
 *
 * ponytail: keyed by client IP, so it is only as strong as that address. Behind
 * a reverse proxy the instance must be configured so clients cannot forge the
 * forwarded-for header, or a single machine can mint unlimited distinct keys.
 */
export function rateLimit(key: string, limit = 10, windowMs = 60_000, now = Date.now()): boolean {
	const window = windows.get(key);
	if (window && window.resetAt > now) {
		if (window.count >= limit) return false;
		window.count++;
		return true;
	}

	if (windows.size >= MAX_WINDOWS) {
		for (const [k, w] of windows) if (w.resetAt <= now) windows.delete(k);
		// Still full means every window is live, so expiry-based pruning cannot
		// help. Map iterates in insertion order, so dropping from the front
		// evicts the oldest. Evicting a live window only ever hands that key a
		// fresh budget, so it cannot be used to win extra allowance.
		while (windows.size >= MAX_WINDOWS) {
			const oldest = windows.keys().next();
			if (oldest.done) break;
			windows.delete(oldest.value);
		}
	}

	windows.set(key, { count: 1, resetAt: now + windowMs });
	return true;
}

export function resetRateLimits(): void {
	windows.clear();
}
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npx vitest run src/lib/server/auth src/lib/server/rate-limit.test.ts`
Expected: PASS, 14 tests.

- [ ] **Step 7: Commit**

```bash
git add src/lib/server/auth src/lib/server/rate-limit.ts src/lib/server/rate-limit.test.ts
git commit -m "feat(auth): hashed tokens, sliding server-side sessions, rate limiting"
```

---

## Task 6: Request pipeline — locale, session, setup guard, app shell

**Files:**
- Create: `src/lib/server/settings.ts`, `src/lib/server/settings.test.ts`, `src/hooks.server.ts`, `src/routes/+layout.server.ts`, `src/routes/locale/+server.ts`
- Modify: `src/app.d.ts`, `src/routes/+layout.svelte`

**Interfaces:**
- Consumes: `t`, `resolveLocale`, `Locale` (Task 2); `db` singleton (Task 4); `validateSession`, `setSessionCookie`, `SESSION_COOKIE` (Task 5).
- Produces:
  - `getSetting(db: DB, key: string): string | null`
  - `setSetting(db: DB, key: string, value: string): void`
  - `isSetupComplete(db: DB): boolean`
  - `getTimezone(db: DB): string` — defaults to `'UTC'`
  - `App.Locals = { locale: Locale; user: SessionUser | null }`
  - Layout data `{ locale, user }` available to every page via `$props()`

- [ ] **Step 1: Write the failing test**

`src/lib/server/settings.test.ts`:

```ts
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
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/lib/server/settings.test.ts`
Expected: FAIL — cannot resolve `./settings`.

- [ ] **Step 3: Implement settings**

`src/lib/server/settings.ts`:

```ts
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
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/lib/server/settings.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Declare the request-local types**

`src/app.d.ts`:

```ts
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
```

- [ ] **Step 6: Write the hook**

`src/hooks.server.ts`:

```ts
import { dev } from '$app/environment';
import { resolveLocale } from '$lib/i18n';
import { SESSION_COOKIE, setSessionCookie, validateSession } from '$lib/server/auth/session';
import { db } from '$lib/server/db';
import { isSetupComplete } from '$lib/server/settings';
import { redirect, type Handle } from '@sveltejs/kit';

export const handle: Handle = async ({ event, resolve }) => {
	event.locals.locale = resolveLocale(
		event.request.headers.get('accept-language'),
		event.cookies.get('locale')
	);

	const token = event.cookies.get(SESSION_COOKIE);
	const session = token ? validateSession(db, token) : null;
	event.locals.user = session?.user ?? null;
	if (session?.refreshed) setSessionCookie(event.cookies, token!, session.expiresAt, !dev);
	if (token && !session) clearSessionCookie(event.cookies);

	// Until an instance admin exists there is nothing to show and nobody to show
	// it to, so every path funnels into /setup (PRD §11). /locale is exempt from
	// that funnel but NOT from the second guard — merging the two conditions into
	// one variable would bounce every post-setup /locale submit away unprocessed,
	// killing the switcher after setup instead of before.
	const setupPath = event.url.pathname.startsWith('/setup');
	const localeRoute = event.url.pathname === '/locale';
	const setupComplete = isSetupComplete(db);
	if (!setupComplete && !setupPath && !localeRoute) redirect(303, '/setup');
	if (setupComplete && setupPath) redirect(303, '/');

	return resolve(event, {
		transformPageChunk: ({ html }) => html.replace('%lang%', event.locals.locale)
	});
};
```

- [ ] **Step 7: Write the layout**

`src/routes/+layout.server.ts`:

```ts
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = ({ locals, url }) => ({
	locale: locals.locale,
	user: locals.user,
	pathname: url.pathname
});
```

`src/lib/server/redirect.ts` — the redirect guard gets its own module because it
is a security boundary and tasks 9 and 10 redirect too. A leading slash is **not**
sufficient: `//host` is protocol-relative, some browsers normalise `/\` to `//`,
and browsers strip ASCII tab/LF/CR *before* resolving a URL — so `/<tab>/host`
would pass a naive prefix check and still navigate off-site:

```ts
function hasControlCharacter(value: string): boolean {
	for (const character of value) {
		const code = character.codePointAt(0) ?? 0;
		// C0 controls (includes tab, line feed and carriage return) and DEL.
		if (code < 0x20 || code === 0x7f) return true;
	}
	return false;
}

export function safeRedirectPath(raw: unknown, fallback = '/'): string {
	const value = typeof raw === 'string' ? raw : '';
	// Reject control characters rather than stripping them: stripping would mean
	// validating one string and returning another, which is the bug being closed.
	if (hasControlCharacter(value)) return fallback;
	if (!value.startsWith('/')) return fallback;
	if (value.startsWith('//') || value.startsWith('/\\')) return fallback;
	return value;
}
```

`src/routes/locale/+server.ts` — a form POST, so no client JS is needed:

```ts
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
```

`src/routes/+layout.svelte`:

```svelte
<script lang="ts">
	import '../app.css';
	import { locales, t } from '$lib/i18n';

	let { data, children } = $props();
</script>

<div class="min-h-screen bg-base-200">
	<nav class="navbar bg-base-100 shadow-sm">
		<a class="btn btn-ghost text-xl" href="/">{t(data.locale, 'app.name')}</a>
		<div class="flex-1"></div>
		{#if data.user}
			<a class="btn btn-ghost min-h-11" href="/groups">{t(data.locale, 'nav.groups')}</a>
			<a class="btn btn-ghost min-h-11" href="/profile">{t(data.locale, 'nav.profile')}</a>
		{/if}
		<form method="POST" action="/locale" class="ml-2">
			<input type="hidden" name="redirectTo" value={data.pathname} />
			<select
				name="locale"
				class="select select-sm"
				aria-label={t(data.locale, 'nav.language')}
				onchange={(e) => e.currentTarget.form?.requestSubmit()}
			>
				{#each locales as locale (locale)}
					<option value={locale} selected={locale === data.locale}>{locale.toUpperCase()}</option>
				{/each}
			</select>
			<noscript><button class="btn btn-sm">{t(data.locale, 'common.save')}</button></noscript>
		</form>
	</nav>

	<main class="mx-auto max-w-3xl p-4">
		{@render children()}
	</main>
</div>
```

- [ ] **Step 8: Verify and commit**

Run: `npm run check && npm run test && npm run build`
Expected: all pass. `npm run dev` then open `http://localhost:5173/` — it redirects to `/setup`, which 404s until Task 7. That is the expected intermediate state.

```bash
git add src/app.d.ts src/hooks.server.ts src/lib/server/settings.ts src/lib/server/settings.test.ts src/routes
git commit -m "feat: request pipeline with locale, session and setup guard"
```

---

## Task 7: Setup screen — first account becomes the instance admin

**Files:**
- Create: `src/lib/server/users.ts`, `src/lib/server/users.test.ts`, `src/routes/setup/+page.server.ts`, `src/routes/setup/+page.svelte`, `src/routes/+page.server.ts`, `src/routes/+page.svelte`
- Modify: `src/lib/i18n/en.json`, `src/lib/i18n/de.json`

**Interfaces:**
- Consumes: `DB`, `users` (Task 3); `generateToken`, `hashToken`, `createSession`, `setSessionCookie` (Task 5); `setSetting`, `isSetupComplete` (Task 6).
- Produces:
  - `createUser(db: DB, displayName: string, isAdmin?: boolean): SessionUser`
  - `regenerateLoginToken(db: DB, userId: string): string`
  - `userByLoginToken(db: DB, token: string): SessionUser | null`
  - `validateDisplayName(raw: FormDataEntryValue | null): string | null`
  - A working `/setup` route that creates the admin, stores the timezone and signs the admin in.

- [ ] **Step 1: Write the failing test**

`src/lib/server/users.test.ts`:

```ts
import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { hashToken } from './auth/tokens';
import { applyMigrations, createDb, type DB } from './db/client';
import { users } from './db/schema';
import { createUser, regenerateLoginToken, userByLoginToken, validateDisplayName } from './users';

let db: DB;

beforeEach(() => {
	db = createDb(':memory:').db;
	applyMigrations(db);
});

describe('createUser', () => {
	it('creates a member by default', () => {
		const user = createUser(db, 'Ada');
		expect(user.displayName).toBe('Ada');
		expect(user.isAdmin).toBe(false);
	});

	it('can create the instance admin', () => {
		expect(createUser(db, 'Root', true).isAdmin).toBe(true);
	});

	it('stores a login token hash that is not derivable from the row', () => {
		const user = createUser(db, 'Ada');
		const row = db.select().from(users).where(eq(users.id, user.id)).get();
		expect(row?.loginTokenHash).toMatch(/^[0-9a-f]{64}$/);
	});

	it('gives two users with the same name different tokens', () => {
		createUser(db, 'Ada');
		createUser(db, 'Ada');
		const rows = db.select().from(users).where(eq(users.displayName, 'Ada')).all();
		expect(rows).toHaveLength(2);
		expect(rows[0].loginTokenHash).not.toBe(rows[1].loginTokenHash);
	});
});

describe('regenerateLoginToken', () => {
	it('returns a token that resolves back to the user', () => {
		const user = createUser(db, 'Ada');
		const token = regenerateLoginToken(db, user.id);
		expect(userByLoginToken(db, token)).toEqual(user);
	});

	it('invalidates the previous token', () => {
		const user = createUser(db, 'Ada');
		const first = regenerateLoginToken(db, user.id);
		regenerateLoginToken(db, user.id);
		expect(userByLoginToken(db, first)).toBeNull();
	});

	it('stores the hash, not the token', () => {
		const user = createUser(db, 'Ada');
		const token = regenerateLoginToken(db, user.id);
		const row = db.select().from(users).where(eq(users.id, user.id)).get();
		expect(row?.loginTokenHash).toBe(hashToken(token));
	});
});

describe('userByLoginToken', () => {
	it('returns null for an unknown token', () => {
		createUser(db, 'Ada');
		expect(userByLoginToken(db, 'not-a-real-token')).toBeNull();
	});
});

describe('validateDisplayName', () => {
	it('trims and accepts a normal name', () => {
		expect(validateDisplayName('  Ada  ')).toBe('Ada');
	});

	it('rejects empty, whitespace-only and over-long names', () => {
		expect(validateDisplayName('')).toBeNull();
		expect(validateDisplayName('   ')).toBeNull();
		expect(validateDisplayName(null)).toBeNull();
		expect(validateDisplayName('x'.repeat(61))).toBeNull();
	});

	it('accepts a name exactly at the limit', () => {
		expect(validateDisplayName('x'.repeat(60))).toHaveLength(60);
	});
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/lib/server/users.test.ts`
Expected: FAIL — cannot resolve `./users`.

- [ ] **Step 3: Implement users**

`src/lib/server/users.ts`:

```ts
import { eq } from 'drizzle-orm';
import type { SessionUser } from './auth/session';
import { generateToken, hashToken } from './auth/tokens';
import type { DB } from './db/client';
import { users } from './db/schema';

export const DISPLAY_NAME_MAX = 60;

export function createUser(db: DB, displayName: string, isAdmin = false): SessionUser {
	const id = crypto.randomUUID();
	// A token is minted so the column is never null; it is not shown anywhere.
	// The profile's "reveal" action regenerates it (see Task 10).
	db.insert(users)
		.values({ id, displayName, isAdmin, loginTokenHash: hashToken(generateToken()) })
		.run();
	return { id, displayName, isAdmin };
}

export function regenerateLoginToken(db: DB, userId: string): string {
	const token = generateToken();
	db.update(users).set({ loginTokenHash: hashToken(token) }).where(eq(users.id, userId)).run();
	return token;
}

export function userByLoginToken(db: DB, token: string): SessionUser | null {
	const row = db
		.select({ id: users.id, displayName: users.displayName, isAdmin: users.isAdmin })
		.from(users)
		.where(eq(users.loginTokenHash, hashToken(token)))
		.get();
	return row ?? null;
}

export function validateDisplayName(raw: FormDataEntryValue | null): string | null {
	const name = String(raw ?? '').trim();
	if (!name || name.length > DISPLAY_NAME_MAX) return null;
	return name;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/lib/server/users.test.ts`
Expected: PASS, 11 tests.

- [ ] **Step 5: Add the translation keys**

Add to `src/lib/i18n/en.json`:

```json
{
	"setup.title": "Set up your instance",
	"setup.intro": "This account becomes the instance admin. Pick the timezone your movie nights happen in.",
	"setup.display_name": "Your display name",
	"setup.timezone": "Timezone",
	"setup.submit": "Create instance",
	"setup.error.name": "Please enter a display name of up to 60 characters.",
	"setup.error.timezone": "Please pick a timezone from the list.",
	"setup.error.done": "This instance is already set up.",
	"home.welcome": "Welcome, {name}",
	"home.no_groups": "You are not in a group yet."
}
```

Add to `src/lib/i18n/de.json`:

```json
{
	"setup.title": "Instanz einrichten",
	"setup.intro": "Dieses Konto wird Instanz-Administrator. Wähle die Zeitzone, in der eure Filmabende stattfinden.",
	"setup.display_name": "Dein Anzeigename",
	"setup.timezone": "Zeitzone",
	"setup.submit": "Instanz erstellen",
	"setup.error.name": "Bitte gib einen Anzeigenamen mit höchstens 60 Zeichen ein.",
	"setup.error.timezone": "Bitte wähle eine Zeitzone aus der Liste.",
	"setup.error.done": "Diese Instanz ist bereits eingerichtet.",
	"home.welcome": "Willkommen, {name}",
	"home.no_groups": "Du bist noch in keiner Gruppe."
}
```

- [ ] **Step 6: Write the setup route**

`src/routes/setup/+page.server.ts` — `Intl.supportedValuesOf` is the stdlib timezone list, so there is no data file to ship or keep current:

```ts
import { dev } from '$app/environment';
import { createSession, setSessionCookie } from '$lib/server/auth/session';
import { db } from '$lib/server/db';
import { isSetupComplete, setSetting } from '$lib/server/settings';
import { createUser, validateDisplayName } from '$lib/server/users';
import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';

const timezones = Intl.supportedValuesOf('timeZone');

export const load: PageServerLoad = () => ({ timezones });

export const actions: Actions = {
	default: async ({ request, cookies }) => {
		const form = await request.formData();
		const displayName = validateDisplayName(form.get('displayName'));
		if (!displayName) return fail(400, { error: 'setup.error.name' });

		const timezone = String(form.get('timezone') ?? '');
		if (!timezones.includes(timezone)) return fail(400, { error: 'setup.error.timezone' });

		// Claiming happens in one transaction inside claimInstance. Checking
		// isSetupComplete here, before the `await` above, would NOT close the race:
		// two concurrent tabs would both read "not complete" and both mint an admin.
		const admin = claimInstance(db, displayName, timezone);
		if (!admin) return fail(403, { error: 'setup.error.done' });

		const { token, expiresAt } = createSession(db, admin.id);
		setSessionCookie(cookies, token, expiresAt, !dev);
		redirect(303, '/groups');
	}
};
```

`src/lib/server/setup.ts` — creating the instance admin is the only unauthenticated
path in the app that grants privilege, so "exactly one" is a security property. The
test and the set must be one atomic step:

```ts
import type { SessionUser } from './auth/session';
import type { DB } from './db/client';
import { isSetupComplete, setSetting } from './settings';
import { createUser } from './users';

/**
 * Claims the instance for its first admin, or returns null if someone already
 * has. The test and the set must happen together: checking before
 * `await request.formData()` in a route lets two concurrent tabs both read
 * "not complete" and both mint an admin.
 *
 * Passing `db` inside the transaction rather than the transaction handle is
 * correct here, and deliberate: better-sqlite3 is a single connection, so BEGIN
 * applies to every statement issued through `db` until COMMIT. Do not "fix"
 * this by threading a `tx` handle through the helpers.
 */
export function claimInstance(db: DB, displayName: string, timezone: string): SessionUser | null {
	return db.transaction(() => {
		if (isSetupComplete(db)) return null;
		const admin = createUser(db, displayName, true);
		setSetting(db, 'timezone', timezone);
		setSetting(db, 'setup_complete', '1');
		return admin;
	});
}
```

`src/routes/setup/+page.svelte`:

```svelte
<script lang="ts">
	import { t } from '$lib/i18n';
	let { data, form } = $props();
</script>

<h1 class="mb-2 text-2xl font-bold">{t(data.locale, 'setup.title')}</h1>
<p class="mb-4">{t(data.locale, 'setup.intro')}</p>

{#if form?.error}
	<div class="alert alert-error mb-4" role="alert">{t(data.locale, form.error)}</div>
{/if}

<form method="POST" class="flex flex-col gap-4">
	<label class="form-control">
		<span class="label-text">{t(data.locale, 'setup.display_name')}</span>
		<input
			name="displayName"
			required
			maxlength="60"
			autocomplete="nickname"
			class="input input-bordered min-h-11"
		/>
	</label>

	<label class="form-control">
		<span class="label-text">{t(data.locale, 'setup.timezone')}</span>
		<select name="timezone" required class="select select-bordered min-h-11">
			{#each data.timezones as tz (tz)}
				<option value={tz} selected={tz === 'Europe/Berlin'}>{tz}</option>
			{/each}
		</select>
	</label>

	<button class="btn btn-primary min-h-11">{t(data.locale, 'setup.submit')}</button>
</form>
```

- [ ] **Step 7: Write the home route**

`src/routes/+page.server.ts` — signed-out visitors have nowhere to go but their invite or login link:

```ts
import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = ({ locals }) => {
	if (locals.user) redirect(303, '/groups');
	return {};
};
```

`src/routes/+page.svelte`:

```svelte
<script lang="ts">
	import { t } from '$lib/i18n';
	let { data } = $props();
</script>

<h1 class="text-2xl font-bold">{t(data.locale, 'app.name')}</h1>
<p>{t(data.locale, 'home.no_groups')}</p>
```

- [ ] **Step 8: Verify by hand and commit**

Run: `npm run test && npm run check && npm run dev`
Expected: `/` redirects to `/setup`; submitting the form lands on `/groups` (404 until Task 8) with a `filmnacht_session` cookie set; reloading `/setup` now redirects to `/`; `data/filmnacht.db` exists.

```bash
rm -rf data   # start the next verification from a clean instance
git add src/lib src/routes
git commit -m "feat(setup): first visit creates the instance admin and timezone"
```

---

## Task 8: Groups and membership authorization

**Files:**
- Create: `src/lib/server/groups.ts`, `src/lib/server/groups.test.ts`, `src/routes/groups/+page.server.ts`, `src/routes/groups/+page.svelte`, `src/routes/groups/[groupId]/+page.server.ts`, `src/routes/groups/[groupId]/+page.svelte`, `src/routes/+error.svelte`

> **On error strings.** `error(401, 'Sign in first')` and `error(404, 'Not found')` stay
> English in the server code deliberately: they are developer-facing labels for logs.
> Translation happens once, at the point of display, in `+error.svelte`, keyed off
> `page.status`. Do not thread `locale` into `requireMember` — that would put a
> presentation concern on the core authorization primitive and repeat at every call
> site. The 404 body must stay identical in every language for both "not a member"
> and "no such group": that sameness is the security property.
- Modify: `src/lib/i18n/en.json`, `src/lib/i18n/de.json`

**Interfaces:**
- Consumes: `DB`, `groups`, `memberships`, `GroupSettings` (Task 3); `createUser` (Task 7).
- Produces:
  - `createGroup(db: DB, input: { name: string; emoji?: string | null; ownerId: string }): string`
  - `requireMember(db: DB, userId: string, groupId: string): GroupMembership` — throws a SvelteKit 404 for non-members
  - `listGroupsFor(db: DB, userId: string): { id: string; name: string; emoji: string | null; role: 'owner' | 'member' }[]`
  - `addMember(db: DB, userId: string, groupId: string): void` — idempotent, re-activates a member who left
  - `listMembers(db: DB, groupId: string): { id: string; displayName: string; role: string }[]`
  - `leaveGroup(db: DB, userId: string, groupId: string): void` — sets `leftAt`, keeps the history
  - `type GroupMembership = { groupId: string; name: string; emoji: string | null; settings: GroupSettings; role: 'owner' | 'member' }`

- [ ] **Step 1: Write the failing test**

`src/lib/server/groups.test.ts`:

```ts
import { beforeEach, describe, expect, it } from 'vitest';
import { applyMigrations, createDb, type DB } from './db/client';
import { DEFAULT_GROUP_SETTINGS } from './db/schema';
import { addMember, createGroup, leaveGroup, listGroupsFor, listMembers, requireMember } from './groups';
import { createUser } from './users';

let db: DB;
let ada: string;
let grace: string;

beforeEach(() => {
	db = createDb(':memory:').db;
	applyMigrations(db);
	ada = createUser(db, 'Ada').id;
	grace = createUser(db, 'Grace').id;
});

function status(fn: () => unknown): number | undefined {
	try {
		fn();
	} catch (e) {
		return (e as { status?: number }).status;
	}
}

describe('createGroup', () => {
	it('makes the creator an owner member in one transaction', () => {
		const id = createGroup(db, { name: 'Movie Club', ownerId: ada });
		expect(requireMember(db, ada, id).role).toBe('owner');
	});

	it('applies the default settings from the PRD', () => {
		const id = createGroup(db, { name: 'Movie Club', ownerId: ada });
		expect(requireMember(db, ada, id).settings).toEqual(DEFAULT_GROUP_SETTINGS);
	});
});

describe('requireMember', () => {
	it('throws 404 — not 403 — for a non-member, so the id is not confirmed', () => {
		const id = createGroup(db, { name: 'Movie Club', ownerId: ada });
		expect(status(() => requireMember(db, grace, id))).toBe(404);
	});

	it('throws the same 404 for a group that does not exist', () => {
		expect(status(() => requireMember(db, ada, 'made-up-id'))).toBe(404);
	});

	it('throws 404 for a member who has left', () => {
		const id = createGroup(db, { name: 'Movie Club', ownerId: ada });
		addMember(db, grace, id);
		leaveGroup(db, grace, id);
		expect(status(() => requireMember(db, grace, id))).toBe(404);
	});
});

describe('addMember', () => {
	it('is idempotent', () => {
		const id = createGroup(db, { name: 'Movie Club', ownerId: ada });
		addMember(db, grace, id);
		addMember(db, grace, id);
		expect(listMembers(db, id)).toHaveLength(2);
	});

	it('re-activates someone who left rather than failing on the unique key', () => {
		const id = createGroup(db, { name: 'Movie Club', ownerId: ada });
		addMember(db, grace, id);
		leaveGroup(db, grace, id);
		addMember(db, grace, id);
		expect(requireMember(db, grace, id).role).toBe('member');
	});
});

describe('listGroupsFor', () => {
	it('lists only the groups the user is currently in', () => {
		const mine = createGroup(db, { name: 'Mine', ownerId: ada });
		createGroup(db, { name: 'Theirs', ownerId: grace });
		expect(listGroupsFor(db, ada)).toEqual([
			{ id: mine, name: 'Mine', emoji: null, role: 'owner' }
		]);
	});
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/lib/server/groups.test.ts`
Expected: FAIL — cannot resolve `./groups`.

- [ ] **Step 3: Implement groups**

`src/lib/server/groups.ts`:

```ts
import { error } from '@sveltejs/kit';
import { and, eq, isNull } from 'drizzle-orm';
import type { DB } from './db/client';
import { groups, memberships, users, type GroupSettings } from './db/schema';

export type GroupMembership = {
	groupId: string;
	name: string;
	emoji: string | null;
	settings: GroupSettings;
	role: 'owner' | 'member';
};

export function createGroup(
	db: DB,
	input: { name: string; emoji?: string | null; ownerId: string }
): string {
	const id = crypto.randomUUID();
	db.transaction((tx) => {
		tx.insert(groups)
			.values({ id, name: input.name, emoji: input.emoji ?? null, ownerId: input.ownerId })
			.run();
		tx.insert(memberships)
			.values({ userId: input.ownerId, groupId: id, role: 'owner' })
			.run();
	});
	return id;
}

/**
 * The only way a route should reach group data. A non-member and a non-existent
 * group produce the identical 404, so a guessed id reveals nothing (PRD §12).
 */
export function requireMember(db: DB, userId: string, groupId: string): GroupMembership {
	const row = db
		.select({
			groupId: groups.id,
			name: groups.name,
			emoji: groups.emoji,
			settings: groups.settings,
			role: memberships.role
		})
		.from(memberships)
		.innerJoin(groups, eq(groups.id, memberships.groupId))
		.where(
			and(
				eq(memberships.groupId, groupId),
				eq(memberships.userId, userId),
				isNull(memberships.leftAt)
			)
		)
		.get();
	if (!row) error(404, 'Not found');
	return row;
}

export function addMember(db: DB, userId: string, groupId: string): void {
	db.insert(memberships)
		.values({ userId, groupId, role: 'member' })
		.onConflictDoUpdate({
			target: [memberships.userId, memberships.groupId],
			set: { leftAt: null }
		})
		.run();
}

/** Access goes, history stays — name included (PRD §4). */
export function leaveGroup(db: DB, userId: string, groupId: string): void {
	db.update(memberships)
		.set({ leftAt: new Date() })
		.where(and(eq(memberships.userId, userId), eq(memberships.groupId, groupId)))
		.run();
}

export function listGroupsFor(db: DB, userId: string) {
	return db
		.select({
			id: groups.id,
			name: groups.name,
			emoji: groups.emoji,
			role: memberships.role
		})
		.from(memberships)
		.innerJoin(groups, eq(groups.id, memberships.groupId))
		.where(and(eq(memberships.userId, userId), isNull(memberships.leftAt)))
		.all();
}

export function listMembers(db: DB, groupId: string) {
	return db
		.select({ id: users.id, displayName: users.displayName, role: memberships.role })
		.from(memberships)
		.innerJoin(users, eq(users.id, memberships.userId))
		.where(and(eq(memberships.groupId, groupId), isNull(memberships.leftAt)))
		.all();
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/lib/server/groups.test.ts`
Expected: PASS, 8 tests.

- [ ] **Step 5: Add the translation keys**

Add to `src/lib/i18n/en.json`:

```json
{
	"groups.title": "Your groups",
	"groups.create": "Create a group",
	"groups.name": "Group name",
	"groups.emoji": "Emoji (optional)",
	"groups.empty": "No groups yet. Create one, or open an invite link a friend sent you.",
	"groups.members": "Members",
	"groups.owner": "Owner",
	"groups.error.name": "Please enter a group name of up to 60 characters."
}
```

Add to `src/lib/i18n/de.json`:

```json
{
	"groups.title": "Deine Gruppen",
	"groups.create": "Gruppe erstellen",
	"groups.name": "Gruppenname",
	"groups.emoji": "Emoji (optional)",
	"groups.empty": "Noch keine Gruppen. Erstelle eine oder öffne einen Einladungslink.",
	"groups.members": "Mitglieder",
	"groups.owner": "Besitzer",
	"groups.error.name": "Bitte gib einen Gruppennamen mit höchstens 60 Zeichen ein."
}
```

- [ ] **Step 6: Write the routes**

`src/routes/groups/+page.server.ts`:

```ts
import { db } from '$lib/server/db';
import { createGroup, listGroupsFor } from '$lib/server/groups';
import { validateDisplayName } from '$lib/server/users';
import { error, fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = ({ locals }) => {
	if (!locals.user) error(401, 'Sign in first');
	return { groups: listGroupsFor(db, locals.user.id) };
};

export const actions: Actions = {
	create: async ({ request, locals }) => {
		if (!locals.user) error(401, 'Sign in first');
		const form = await request.formData();
		// Same rule as a display name: non-empty, trimmed, max 60.
		const name = validateDisplayName(form.get('name'));
		if (!name) return fail(400, { error: 'groups.error.name' });
		const emoji = String(form.get('emoji') ?? '').trim().slice(0, 8) || null;
		const id = createGroup(db, { name, emoji, ownerId: locals.user.id });
		redirect(303, `/groups/${id}`);
	}
};
```

`src/routes/groups/+page.svelte`:

```svelte
<script lang="ts">
	import { t } from '$lib/i18n';
	let { data, form } = $props();
</script>

<h1 class="mb-4 text-2xl font-bold">{t(data.locale, 'groups.title')}</h1>

{#if data.groups.length === 0}
	<p class="mb-4">{t(data.locale, 'groups.empty')}</p>
{:else}
	<ul class="menu bg-base-100 mb-6 rounded-box">
		{#each data.groups as group (group.id)}
			<li>
				<a href="/groups/{group.id}" class="min-h-11">
					<span aria-hidden="true">{group.emoji ?? '🎬'}</span>
					{group.name}
				</a>
			</li>
		{/each}
	</ul>
{/if}

{#if form?.error}
	<div class="alert alert-error mb-4" role="alert">{t(data.locale, form.error)}</div>
{/if}

<form method="POST" action="?/create" class="flex flex-col gap-3">
	<label class="form-control">
		<span class="label-text">{t(data.locale, 'groups.name')}</span>
		<input name="name" required maxlength="60" class="input input-bordered min-h-11" />
	</label>
	<label class="form-control">
		<span class="label-text">{t(data.locale, 'groups.emoji')}</span>
		<input name="emoji" maxlength="8" class="input input-bordered min-h-11 w-24" />
	</label>
	<button class="btn btn-primary min-h-11">{t(data.locale, 'groups.create')}</button>
</form>
```

`src/routes/groups/[groupId]/+page.server.ts`:

```ts
import { db } from '$lib/server/db';
import { listMembers, requireMember } from '$lib/server/groups';
import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = ({ locals, params }) => {
	if (!locals.user) error(401, 'Sign in first');
	const group = requireMember(db, locals.user.id, params.groupId);
	return { group, members: listMembers(db, params.groupId) };
};
```

`src/routes/groups/[groupId]/+page.svelte`:

```svelte
<script lang="ts">
	import { t } from '$lib/i18n';
	let { data } = $props();
</script>

<h1 class="mb-4 text-2xl font-bold">
	<span aria-hidden="true">{data.group.emoji ?? '🎬'}</span>
	{data.group.name}
</h1>

<h2 class="mb-2 text-lg font-semibold">{t(data.locale, 'groups.members')}</h2>
<ul class="list-disc pl-6">
	{#each data.members as member (member.id)}
		<li>
			{member.displayName}
			{#if member.role === 'owner'}<span class="badge badge-sm ml-1"
					>{t(data.locale, 'groups.owner')}</span
				>{/if}
		</li>
	{/each}
</ul>
```

- [ ] **Step 7: Verify by hand and commit**

Run: `npm run test && npm run dev`
Expected: after setup you land on `/groups`, can create one, and are redirected into it as owner. Visiting `/groups/<a-made-up-id>` renders a 404.

```bash
git add src/lib src/routes
git commit -m "feat(groups): create, list and membership-checked group access"
```

---

## Task 9: Invite links

**Files:**
- Create: `src/lib/server/invites.ts`, `src/lib/server/invites.test.ts`, `src/routes/join/[token]/+page.server.ts`, `src/routes/join/[token]/+page.svelte`
- Modify: `src/lib/i18n/en.json`, `src/lib/i18n/de.json`, `src/routes/groups/[groupId]/+page.server.ts`, `src/routes/groups/[groupId]/+page.svelte`

**Interfaces:**
- Consumes: `generateToken`, `hashToken` (Task 5); `addMember`, `requireMember` (Task 8); `createUser`, `validateDisplayName` (Task 7); `rateLimit` (Task 5).
- Produces:
  - `INVITE_TTL_DAYS = 7`
  - `createInvite(db: DB, input: { groupId: string; createdBy: string; maxUses?: number | null; now?: number }): string` — returns the raw token, shown once
  - `lookupInvite(db: DB, token: string, now?: number): { groupId: string; groupName: string; groupEmoji: string | null } | null`
  - `redeemInvite(db: DB, token: string, userId: string, now?: number): string | null` — returns the group id joined, or `null` if the invite is invalid

- [ ] **Step 1: Write the failing test**

`src/lib/server/invites.test.ts`:

```ts
import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { applyMigrations, createDb, type DB } from './db/client';
import { invites, memberships } from './db/schema';
import { createGroup, listMembers } from './groups';
import { createInvite, INVITE_TTL_DAYS, lookupInvite, redeemInvite } from './invites';
import { createUser } from './users';

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.UTC(2026, 8, 21);

let db: DB;
let ada: string;
let grace: string;
let groupId: string;

beforeEach(() => {
	db = createDb(':memory:').db;
	applyMigrations(db);
	ada = createUser(db, 'Ada').id;
	grace = createUser(db, 'Grace').id;
	groupId = createGroup(db, { name: 'Movie Club', ownerId: ada });
});

describe('createInvite', () => {
	it('returns a 128-bit token and stores only its hash', () => {
		const token = createInvite(db, { groupId, createdBy: ada, now: NOW });
		expect(token).toMatch(/^[A-Za-z0-9_-]{22}$/);
		const row = db.select().from(invites).get();
		expect(row?.tokenHash).not.toBe(token);
		expect(row?.uses).toBe(0);
		expect(row?.maxUses).toBeNull();
	});

	it('expires after seven days by default', () => {
		createInvite(db, { groupId, createdBy: ada, now: NOW });
		const row = db.select().from(invites).get();
		expect(row?.expiresAt.getTime()).toBe(NOW + INVITE_TTL_DAYS * DAY);
	});
});

describe('lookupInvite', () => {
	it('resolves a live token to its group', () => {
		const token = createInvite(db, { groupId, createdBy: ada, now: NOW });
		expect(lookupInvite(db, token, NOW + DAY)).toEqual({
			groupId,
			groupName: 'Movie Club',
			groupEmoji: null
		});
	});

	it('returns null once the token has expired', () => {
		const token = createInvite(db, { groupId, createdBy: ada, now: NOW });
		expect(lookupInvite(db, token, NOW + 8 * DAY)).toBeNull();
	});

	it('returns null for an unknown token', () => {
		// The table must hold a live row, or this passes even with the hash
		// comparison removed entirely.
		createInvite(db, { groupId, createdBy: ada, now: NOW });
		expect(lookupInvite(db, 'not-a-real-token', NOW)).toBeNull();
	});

	it('returns null once the redemption cap is reached', () => {
		const token = createInvite(db, { groupId, createdBy: ada, maxUses: 1, now: NOW });
		redeemInvite(db, token, grace, NOW);
		expect(lookupInvite(db, token, NOW)).toBeNull();
	});
});

describe('redeemInvite', () => {
	it('adds the member and counts the use', () => {
		const token = createInvite(db, { groupId, createdBy: ada, now: NOW });
		expect(redeemInvite(db, token, grace, NOW)).toBe(groupId);
		expect(listMembers(db, groupId)).toHaveLength(2);
		expect(db.select().from(invites).get()?.uses).toBe(1);
	});

	it('is reusable by default', () => {
		const token = createInvite(db, { groupId, createdBy: ada, now: NOW });
		const carol = createUser(db, 'Carol').id;
		redeemInvite(db, token, grace, NOW);
		redeemInvite(db, token, carol, NOW);
		expect(listMembers(db, groupId)).toHaveLength(3);
	});

	it('does not count a second use for someone already in the group', () => {
		const token = createInvite(db, { groupId, createdBy: ada, now: NOW });
		redeemInvite(db, token, grace, NOW);
		expect(redeemInvite(db, token, grace, NOW)).toBe(groupId);
		expect(db.select().from(invites).get()?.uses).toBe(1);
		expect(
			db.select().from(memberships).where(eq(memberships.userId, grace)).all()
		).toHaveLength(1);
	});

	it('refuses an expired token without touching membership', () => {
		const token = createInvite(db, { groupId, createdBy: ada, now: NOW });
		expect(redeemInvite(db, token, grace, NOW + 8 * DAY)).toBeNull();
		expect(listMembers(db, groupId)).toHaveLength(1);
	});
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/lib/server/invites.test.ts`
Expected: FAIL — cannot resolve `./invites`.

- [ ] **Step 3: Implement invites**

`src/lib/server/invites.ts`:

```ts
import { and, eq, gt, isNull, or, sql } from 'drizzle-orm';
import { generateToken, hashToken } from './auth/tokens';
import type { DB } from './db/client';
import { groups, invites, memberships } from './db/schema';

export const INVITE_TTL_DAYS = 7;

export function createInvite(
	db: DB,
	input: { groupId: string; createdBy: string; maxUses?: number | null; now?: number }
): string {
	const now = input.now ?? Date.now();
	const token = generateToken();
	db.insert(invites)
		.values({
			tokenHash: hashToken(token),
			groupId: input.groupId,
			createdBy: input.createdBy,
			maxUses: input.maxUses ?? null,
			expiresAt: new Date(now + INVITE_TTL_DAYS * 24 * 60 * 60 * 1000)
		})
		.run();
	return token;
}

/** Live means: the hash matches, it has not expired, and the cap is not reached. */
export function lookupInvite(db: DB, token: string, now = Date.now()) {
	const row = db
		.select({
			groupId: groups.id,
			groupName: groups.name,
			groupEmoji: groups.emoji
		})
		.from(invites)
		.innerJoin(groups, eq(groups.id, invites.groupId))
		.where(
			and(
				eq(invites.tokenHash, hashToken(token)),
				gt(invites.expiresAt, new Date(now)),
				or(isNull(invites.maxUses), sql`${invites.uses} < ${invites.maxUses}`)
			)
		)
		.get();
	return row ?? null;
}

export function redeemInvite(
	db: DB,
	token: string,
	userId: string,
	now = Date.now()
): string | null {
	const invite = lookupInvite(db, token, now);
	if (!invite) return null;

	return db.transaction((tx) => {
		// Opening the same link twice must not burn a redemption from the cap.
		const existing = tx
			.select({ userId: memberships.userId })
			.from(memberships)
			.where(
				and(
					eq(memberships.groupId, invite.groupId),
					eq(memberships.userId, userId),
					isNull(memberships.leftAt)
				)
			)
			.get();
		if (existing) return invite.groupId;

		tx.insert(memberships)
			.values({ userId, groupId: invite.groupId, role: 'member' })
			.onConflictDoUpdate({
				target: [memberships.userId, memberships.groupId],
				set: { leftAt: null }
			})
			.run();
		tx.update(invites)
			.set({ uses: sql`${invites.uses} + 1` })
			.where(eq(invites.tokenHash, hashToken(token)))
			.run();
		return invite.groupId;
	});
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/lib/server/invites.test.ts`
Expected: PASS, 10 tests.

- [ ] **Step 5: Add the translation keys**

Add to `src/lib/i18n/en.json`:

```json
{
	"invite.create": "Create invite link",
	"invite.created": "Send this link to your friends. It works for 7 days.",
	"invite.join_title": "Join {group}",
	"invite.join_name": "What should the group call you?",
	"invite.join_submit": "Join the group",
	"invite.invalid": "This invite link is no longer valid. Ask for a new one.",
	"invite.error.name": "Please enter a display name of up to 60 characters.",
	"invite.rate_limited": "Too many attempts. Try again in a minute."
}
```

Add to `src/lib/i18n/de.json`:

```json
{
	"invite.create": "Einladungslink erstellen",
	"invite.created": "Schick diesen Link an deine Freunde. Er gilt 7 Tage.",
	"invite.join_title": "{group} beitreten",
	"invite.join_name": "Wie soll die Gruppe dich nennen?",
	"invite.join_submit": "Gruppe beitreten",
	"invite.invalid": "Dieser Einladungslink ist nicht mehr gültig. Bitte um einen neuen.",
	"invite.error.name": "Bitte gib einen Anzeigenamen mit höchstens 60 Zeichen ein.",
	"invite.rate_limited": "Zu viele Versuche. Versuch es in einer Minute erneut."
}
```

- [ ] **Step 6: Add the invite action to the group page**

`src/routes/groups/[groupId]/+page.server.ts` already imports `db`, `requireMember` and `error` for its `load`. Add the two new imports and the whole `actions` export below it:

```ts
import { createInvite } from '$lib/server/invites';
import type { Actions } from './$types';

export const actions: Actions = {
	invite: async ({ locals, params, url }) => {
		if (!locals.user) error(401, 'Sign in first');
		const membership = requireMember(db, locals.user.id, params.groupId);
		if (membership.role !== 'owner') error(403, 'Only the owner can invite');
		const token = createInvite(db, { groupId: params.groupId, createdBy: locals.user.id });
		// Returned once and never stored in the clear — the row holds only the hash.
		return { inviteUrl: `${url.origin}/join/${token}` };
	}
};
```

Append to `src/routes/groups/[groupId]/+page.svelte`:

```svelte
{#if data.group.role === 'owner'}
	<form method="POST" action="?/invite" class="mt-6">
		<button class="btn btn-secondary min-h-11">{t(data.locale, 'invite.create')}</button>
	</form>
	{#if form?.inviteUrl}
		<p class="mt-2">{t(data.locale, 'invite.created')}</p>
		<input class="input input-bordered mt-1 w-full" readonly value={form.inviteUrl} />
	{/if}
{/if}
```

Add `form` to that page's props: `let { data, form } = $props();`

- [ ] **Step 7: Write the join route**

`src/routes/join/[token]/+page.server.ts` — one route covers both cases: a signed-in visitor joins immediately, a stranger picks a name and gets an account (PRD §9):

```ts
import { dev } from '$app/environment';
import { createSession, setSessionCookie } from '$lib/server/auth/session';
import { db } from '$lib/server/db';
import { lookupInvite, redeemInvite } from '$lib/server/invites';
import { rateLimit } from '$lib/server/rate-limit';
import { createUser, validateDisplayName } from '$lib/server/users';
import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = ({ params, locals, getClientAddress }) => {
	if (!rateLimit(`join:${getClientAddress()}`, 20, 60_000)) {
		return { invite: null, rateLimited: true };
	}
	const invite = lookupInvite(db, params.token);
	if (invite && locals.user) {
		redeemInvite(db, params.token, locals.user.id);
		redirect(303, `/groups/${invite.groupId}`);
	}
	return { invite, rateLimited: false };
};

export const actions: Actions = {
	default: async ({ request, params, cookies, getClientAddress }) => {
		if (!rateLimit(`join:${getClientAddress()}`, 20, 60_000)) {
			return fail(429, { error: 'invite.rate_limited' });
		}

		const form = await request.formData();
		const displayName = validateDisplayName(form.get('displayName'));
		if (!displayName) return fail(400, { error: 'invite.error.name' });

		// Past the last await nothing yields: better-sqlite3 is synchronous and
		// Node is single-threaded, so the invite cannot change under us between
		// this lookup and the redeem. Checking BEFORE the await could not make
		// that promise — an invite expiring in the window would still have
		// produced a session for an account with no membership.
		const invite = lookupInvite(db, params.token);
		if (!invite) return fail(410, { error: 'invite.invalid' });

		const user = createUser(db, displayName);
		const joinedGroupId = redeemInvite(db, params.token, user.id);
		if (!joinedGroupId) return fail(410, { error: 'invite.invalid' });

		const { token, expiresAt } = createSession(db, user.id);
		setSessionCookie(cookies, token, expiresAt, !dev);
		redirect(303, `/groups/${joinedGroupId}`);
	}
};
```

`src/routes/join/[token]/+page.svelte`:

```svelte
<script lang="ts">
	import { t } from '$lib/i18n';
	let { data, form } = $props();
</script>

{#if data.rateLimited}
	<div class="alert alert-warning" role="alert">{t(data.locale, 'invite.rate_limited')}</div>
{:else if !data.invite}
	<div class="alert alert-error" role="alert">{t(data.locale, 'invite.invalid')}</div>
{:else}
	<h1 class="mb-4 text-2xl font-bold">
		{t(data.locale, 'invite.join_title', { group: data.invite.groupName })}
	</h1>

	{#if form?.error}
		<div class="alert alert-error mb-4" role="alert">{t(data.locale, form.error)}</div>
	{/if}

	<form method="POST" class="flex flex-col gap-3">
		<label class="form-control">
			<span class="label-text">{t(data.locale, 'invite.join_name')}</span>
			<input
				name="displayName"
				required
				maxlength="60"
				autocomplete="nickname"
				class="input input-bordered min-h-11"
			/>
		</label>
		<button class="btn btn-primary min-h-11">{t(data.locale, 'invite.join_submit')}</button>
	</form>
{/if}
```

- [ ] **Step 8: Verify by hand and commit**

Run: `npm run test && npm run dev`
Expected: as the owner, create an invite; open the link in a private window; entering a name creates an account and lands in the group; reopening the link while signed in goes straight to the group without a second membership row.

```bash
git add src/lib src/routes
git commit -m "feat(invites): reusable 7-day invite links that create accounts"
```

---

## Task 10: Personal login link, profile and sign-out

**Files:**
- Create: `src/routes/profile/+page.server.ts`, `src/routes/profile/+page.svelte`, `src/routes/login/[token]/+page.server.ts`, `src/routes/login/[token]/+page.svelte`, `src/routes/logout/+server.ts`
- Modify: `src/lib/i18n/en.json`, `src/lib/i18n/de.json`

**Interfaces:**
- Consumes: `regenerateLoginToken`, `userByLoginToken` (Task 7); `createSession`, `deleteSession`, `setSessionCookie`, `clearSessionCookie`, `SESSION_COOKIE` (Task 5); `rateLimit` (Task 5); `listGroupsFor` (Task 8).
- Produces: a working `/login/<token>` second-device sign-in and a profile that can reveal and rotate that link.

- [ ] **Step 1: Write the failing test**

There is no new pure logic here — the behaviour is `regenerateLoginToken` + `userByLoginToken`, already covered in Task 7. What is worth a test is the rule the routes depend on: a revealed link signs exactly one person in, and revealing again kills the old one.

Append to `src/lib/server/users.test.ts`:

```ts
describe('login link round trip', () => {
	it('signs in the right user and only that user', () => {
		const ada = createUser(db, 'Ada');
		const grace = createUser(db, 'Grace');
		const adaToken = regenerateLoginToken(db, ada.id);
		const graceToken = regenerateLoginToken(db, grace.id);
		expect(userByLoginToken(db, adaToken)?.id).toBe(ada.id);
		expect(userByLoginToken(db, graceToken)?.id).toBe(grace.id);
	});

	it('revoking by revealing again makes the old link dead on arrival', () => {
		const ada = createUser(db, 'Ada');
		const old = regenerateLoginToken(db, ada.id);
		const fresh = regenerateLoginToken(db, ada.id);
		expect(userByLoginToken(db, old)).toBeNull();
		expect(userByLoginToken(db, fresh)?.id).toBe(ada.id);
	});
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/lib/server/users.test.ts`
Expected: PASS already — these two assertions are satisfied by Task 7's implementation. That is the point: this step confirms the invariant the routes rely on before the routes exist. If either fails, stop and fix `users.ts` before continuing.

- [ ] **Step 3: Add the translation keys**

Add to `src/lib/i18n/en.json`:

```json
{
	"profile.title": "Profile",
	"profile.login_link": "Your personal login link",
	"profile.login_link_hint": "Open this link on another device to sign in there. Anyone who has it can sign in as you, so share it only with yourself.",
	"profile.reveal": "Reveal login link",
	"profile.reveal_warning": "Revealing generates a new link and invalidates the previous one. Devices already signed in stay signed in.",
	"profile.logout": "Sign out",
	"login.signed_in": "Signed in. Welcome back, {name}.",
	"login.invalid": "This login link is not valid any more. Reveal a new one on a device where you are still signed in.",
	"login.rate_limited": "Too many attempts. Try again in a minute."
}
```

Add to `src/lib/i18n/de.json`:

```json
{
	"profile.title": "Profil",
	"profile.login_link": "Dein persönlicher Login-Link",
	"profile.login_link_hint": "Öffne diesen Link auf einem anderen Gerät, um dich dort anzumelden. Wer ihn hat, kann sich als du anmelden — teile ihn nur mit dir selbst.",
	"profile.reveal": "Login-Link anzeigen",
	"profile.reveal_warning": "Beim Anzeigen wird ein neuer Link erzeugt, der alte wird ungültig. Bereits angemeldete Geräte bleiben angemeldet.",
	"profile.logout": "Abmelden",
	"login.signed_in": "Angemeldet. Willkommen zurück, {name}.",
	"login.invalid": "Dieser Login-Link ist nicht mehr gültig. Zeige auf einem noch angemeldeten Gerät einen neuen an.",
	"login.rate_limited": "Zu viele Versuche. Versuch es in einer Minute erneut."
}
```

- [ ] **Step 4: Write the profile route**

`src/routes/profile/+page.server.ts`:

```ts
import { db } from '$lib/server/db';
import { listGroupsFor } from '$lib/server/groups';
import { regenerateLoginToken } from '$lib/server/users';
import { error } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = ({ locals }) => {
	if (!locals.user) error(401, 'Sign in first');
	return { groups: listGroupsFor(db, locals.user.id) };
};

export const actions: Actions = {
	reveal: async ({ locals, url }) => {
		if (!locals.user) error(401, 'Sign in first');
		// Only the hash is stored (PRD §10), so the link cannot be shown again —
		// revealing mints a fresh one, which is also the "revoke" of PRD §9.
		const token = regenerateLoginToken(db, locals.user.id);
		return { loginUrl: `${url.origin}/login/${token}` };
	}
};
```

`src/routes/profile/+page.svelte`:

```svelte
<script lang="ts">
	import { t } from '$lib/i18n';
	let { data, form } = $props();
</script>

<h1 class="mb-4 text-2xl font-bold">{t(data.locale, 'profile.title')}</h1>
<p class="mb-6">{data.user?.displayName}</p>

<h2 class="mb-1 text-lg font-semibold">{t(data.locale, 'profile.login_link')}</h2>
<p class="mb-2 text-sm">{t(data.locale, 'profile.login_link_hint')}</p>
<p class="mb-3 text-sm opacity-70">{t(data.locale, 'profile.reveal_warning')}</p>

<form method="POST" action="?/reveal">
	<button class="btn btn-secondary min-h-11">{t(data.locale, 'profile.reveal')}</button>
</form>

{#if form?.loginUrl}
	<label class="form-control mt-3">
		<span class="label-text">{t(data.locale, 'profile.login_link')}</span>
		<input class="input input-bordered w-full" readonly value={form.loginUrl} />
	</label>
{/if}

<form method="POST" action="/logout" class="mt-8">
	<button class="btn btn-ghost min-h-11">{t(data.locale, 'profile.logout')}</button>
</form>
```

- [ ] **Step 5: Write the login and logout routes**

`src/routes/login/[token]/+page.server.ts` — the rate limit here is the one that matters, since this endpoint trades a token for a session (PRD §12):

```ts
import { dev } from '$app/environment';
import { createSession, setSessionCookie } from '$lib/server/auth/session';
import { db } from '$lib/server/db';
import { rateLimit } from '$lib/server/rate-limit';
import { userByLoginToken } from '$lib/server/users';
import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = ({ params, cookies, getClientAddress }) => {
	if (!rateLimit(`login:${getClientAddress()}`, 10, 60_000)) {
		return { status: 'rate_limited' as const };
	}
	const user = userByLoginToken(db, params.token);
	if (!user) return { status: 'invalid' as const };

	const { token, expiresAt } = createSession(db, user.id);
	setSessionCookie(cookies, token, expiresAt, !dev);
	redirect(303, '/groups');
};
```

`src/routes/login/[token]/+page.svelte`:

```svelte
<script lang="ts">
	import { t } from '$lib/i18n';
	let { data } = $props();
</script>

<div class="alert alert-error" role="alert">
	{t(data.locale, data.status === 'rate_limited' ? 'login.rate_limited' : 'login.invalid')}
</div>
```

`src/routes/logout/+server.ts`:

```ts
import { clearSessionCookie, deleteSession, SESSION_COOKIE } from '$lib/server/auth/session';
import { db } from '$lib/server/db';
import { redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = ({ cookies }) => {
	const token = cookies.get(SESSION_COOKIE);
	if (token) deleteSession(db, token);
	clearSessionCookie(cookies);
	redirect(303, '/');
};
```

- [ ] **Step 6: Verify the whole flow by hand**

Run: `rm -rf data && npm run dev`

Walk the acceptance path end to end:

1. `/` redirects to `/setup`; create the admin with a timezone → lands on `/groups`.
2. Create a group → lands on the group page as owner.
3. Create an invite link; open it in a private window; enter a name → that browser is now a second member.
4. In the first browser, `/profile` → **Reveal login link**; copy it.
5. In a third private window, open that login link → signed in as the admin, `/groups` shows the group.
6. Reveal again in the first browser; the link from step 4 now shows "not valid any more".
7. Switch the language selector to DE; the navigation and the setup/profile copy change; reload keeps German.
8. Sign out; `/groups` returns 401.

- [ ] **Step 7: Run everything and commit**

Run: `npm run lint && npm run check && npm run test && npm run build`
Expected: all green across all ten test files.

```bash
git add src/lib src/routes
git commit -m "feat(auth): personal login link, profile reveal and sign-out"
```

---

## Self-review

**Spec coverage.** PRD §3 roles: instance admin (`users.is_admin`, Task 7) and owner/member (`memberships.role`, Task 8) exist; the admin UI itself belongs to Plan 5. §4 groups, settings JSON with defaults, invite links with expiry and cap, and leaving without erasing history: Tasks 3, 8, 9. §9 authentication in full: Tasks 5, 7, 9, 10. §10 data model: every table created in Task 3. §11 SQLite + WAL, Drizzle, automatic migration with pre-migration backup: Tasks 3–4; Docker and compose are Plan 5. §12 UTC storage, instance timezone, hashed session tokens, 128-bit tokens, rate limiting, server-side membership checks, English source strings with German shipped: Tasks 2–10. CSRF comes from SvelteKit's built-in same-origin check on form POSTs — no code, but confirm `ORIGIN` is set in production or adapter-node will reject proxied POSTs.

**Not in this plan, by design:** the movie pool and TMDB (Plan 2), movie nights and the draw (Plan 3), ratings and the reveal (Plan 4), Docker/CI/README/PWA/account deletion and export (Plan 5). §7's `ratings` and §6's `movie_nights` tables are created here so those plans add rows, not migrations.

**Open risk to watch during Task 3:** `db.transaction()` callbacks in Drizzle's better-sqlite3 driver are synchronous. `createGroup` and `redeemInvite` rely on that. If a later plan needs an `await` inside a transaction, restructure the call rather than reaching for an async transaction.

---

## Plan sequence

| Plan | Delivers | Depends on |
| --- | --- | --- |
| **1. Foundation & access** (this one) | Instance setup, groups, invites, login links, i18n, schema, migrations | — |
| 2. Movie pool | TMDB search, manual fallback, `dedupe_key`, pool grid, withdraw, per-member cap | 1 |
| 3. Nights & the draw | Scheduling, RSVP, the four states, fairness-weighted draw, seeded append-only log, 1000-night simulation test | 1, 2 |
| 4. Ratings | Window arithmetic, blind submission, reveal, average and spread | 1, 3 |
| 5. Ship it | Multi-arch Docker on a glibc base, compose, CI, README/LICENSE/CONTRIBUTING, backup command, PWA manifest, a11y pass | 1–4 |
