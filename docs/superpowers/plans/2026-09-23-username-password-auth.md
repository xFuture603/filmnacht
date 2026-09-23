# filmnacht — Plan 3: Username and Password Authentication Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A member signs in with a username and a password. Registration stays invite-only, the personal login link survives as the recovery that needs no mail server, and an instance with no SMTP anywhere is fully functional.

**Architecture:** Unchanged in shape from Plans 1 and 2 — pure functions in `src/lib/server/**` taking the Drizzle `db` handle first, routes as thin wrappers. Password hashing is `scrypt` from `node:crypto`: no dependency, no native module, nothing for an operator's arm64 box to fail to compile. This is the first plan with a **real migration over existing rows**, so the schema work is deliberately conservative.

**Tech Stack:** Unchanged — SvelteKit 2 / Svelte 5, better-sqlite3 + Drizzle, Tailwind 4 + daisyUI 5, Vitest. No new dependency.

**Spec:** `prd.md` §9 (rewritten for this change), §4, §12. §14 decisions #8, #9, #17 are marked revised and #20 is new.

**Predecessors:** `docs/superpowers/2026-09-21-foundation-access-decisions.md` and `docs/superpowers/2026-09-22-movie-pool-decisions.md`. Several of their rulings bind this plan; the rate-limit one below is load-bearing.

## Global Constraints

Carried forward, all still binding:

- Node 24, npm. Prettier (tabs, single quotes, no trailing commas, 100 cols) enforced by `npm run lint`.
- **English is the source language in code.** Every user-facing string through `t(locale, key)`; every new key in **both** `en.json` and `de.json`. A parity test now enforces this mechanically — keep it passing.
- All timestamps stored UTC as integer unix seconds.
- **No module under `src/lib/server/**` may import `$env/*`** except `src/lib/server/db/index.ts`. Routes may read env.
- Every group query checked server-side against membership; a non-member gets **404, never 403**.
- **Authorization early, freshness late.** A membership check that gates expensive or outbound work goes *before* the first `await`; a check whose result is written against goes *after* the last one. They are different checks — Plan 2 learned this the hard way.
- **Past the last `await`, nothing yields.** Before it, that guarantee does not exist. This project has shipped check-yield-act three times.
- Accessibility binding: 44px interactive controls, `role="alert"` on error banners, distinct accessible names for repeated controls.
- Server-side `error(...)` strings stay English as developer-facing log labels; `+error.svelte` renders the translated text by status.

New for this plan, and the first two are the ones that matter:

- **Login must not enable user enumeration.** A wrong username and a wrong password must be indistinguishable in response body, status **and timing**. Because `scrypt` is deliberately slow, an early return on "no such user" is a timing oracle — so the handler hashes against a dummy even when the username is unknown.
- **The login rate limit may not be keyed on the username alone.** `src/lib/server/rate-limit.ts` shares one global map with oldest-first eviction, and eviction is by insertion order, so it drops the oldest window whatever its key — nothing in that map is immune, the IP-keyed windows included. What an attacker-chosen key space costs is the ability to *cause* the flood: a username-keyed limiter lets one attacker mint 10,000 distinct keys and evict live windows, which an IP address or a user id cannot do. **The IP-keyed limit is the primary gate and is always checked; the username-keyed limit is defence-in-depth against a distributed attack on one account.** Check both; never the username alone. Both are hard caps only below the flood rate (>=33 req/s sustained); above it both degrade continuously, and the fix would be one map per limiter class rather than anything at a call site.
- **`login never depends on SMTP`** (PRD §9). Nothing in this plan may make signing in require mail. SMTP arrives in Plan 4 for reset only.
- **No new runtime dependency.** `scrypt` is in `node:crypto`. If you find yourself reaching for bcrypt or argon2, stop and report.

## The schema is rebuilt, not migrated

filmnacht has never been deployed. It exists on one developer machine, and the
only database is a test one that gets deleted between runs. So this plan does
**not** carry the cost of a migration over live rows: migration `0000` is
regenerated from scratch with the new columns in place, exactly as Plan 1 did.

That buys a better schema than a real migration would have allowed — SQLite
cannot add a `NOT NULL` column to a populated table, so a live instance would
have forced `username` and `password_hash` to be nullable with the application
enforcing what the database should. Here they can simply be required:

| Column | Constraint |
| --- | --- |
| `username` | `TEXT NOT NULL`, unique |
| `password_hash` | `TEXT NOT NULL` |
| `email` | `TEXT`, nullable — genuinely optional, forever |

**Consequence accepted deliberately:** when v2 adds OIDC, a provider-backed
account has no password and `password_hash` will need relaxing — one `ALTER`
inside a migration already doing far more. That is the right trade: a nullable
column today would mean every read of it reasoning about a state that cannot
occur.

**Consequence for anyone running this:** `rm -rf data` before the first run
after this plan lands. An instance created before it is not upgraded, it is
replaced. Stated here so it is a decision rather than a surprise.

---

## File Structure

| File | Responsibility |
| --- | --- |
| `src/lib/server/auth/password.ts` | `hashPassword`, `verifyPassword`, `validatePassword`. Pure, `node:crypto` only. |
| `src/lib/server/users.ts` | *(modified)* gains `userByUsername`, `setPassword`, `validateUsername`; `createUser` takes a username. |
| `src/lib/server/db/schema.ts` | *(modified)* `username`, `password_hash`, and the unique index. |
| `src/routes/login/+page.svelte` + `.server.ts` | The login form. Sits alongside the existing `/login/[token]`. |
| `src/routes/join/[token]/` | *(modified)* the join form gains username and password. |
| `src/routes/profile/` | *(modified)* change password, set email, change display name. |

---

## Task 1: Password hashing

**Files:**
- Create: `src/lib/server/auth/password.ts`, `src/lib/server/auth/password.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `PASSWORD_MIN = 8`, `PASSWORD_MAX = 200`
  - `hashPassword(password: string): Promise<string>`
  - `verifyPassword(password: string, stored: string | null): Promise<boolean>`
  - `validatePassword(raw: FormDataEntryValue | null): string | null`

- [ ] **Step 1: Write the failing test**

`src/lib/server/auth/password.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { hashPassword, PASSWORD_MAX, PASSWORD_MIN, validatePassword, verifyPassword } from './password';

describe('hashPassword', () => {
	it('produces a verifiable hash', async () => {
		const stored = await hashPassword('correct horse battery staple');
		expect(await verifyPassword('correct horse battery staple', stored)).toBe(true);
	});

	it('rejects the wrong password', async () => {
		const stored = await hashPassword('correct horse battery staple');
		expect(await verifyPassword('Correct horse battery staple', stored)).toBe(false);
	});

	it('salts, so the same password hashes differently every time', async () => {
		const a = await hashPassword('same password');
		const b = await hashPassword('same password');
		expect(a).not.toBe(b);
		expect(await verifyPassword('same password', a)).toBe(true);
		expect(await verifyPassword('same password', b)).toBe(true);
	});

	it('never stores the password itself', async () => {
		const stored = await hashPassword('hunter2');
		expect(stored).not.toContain('hunter2');
	});

	it('records the scheme, so a future change can be told apart', async () => {
		expect(await hashPassword('x')).toMatch(/^scrypt\$/);
	});
});

describe('verifyPassword', () => {
	it('returns false for an account with no password rather than throwing', async () => {
		expect(await verifyPassword('anything', null)).toBe(false);
	});

	it('returns false for a stored value it cannot parse', async () => {
		expect(await verifyPassword('anything', 'not-a-hash')).toBe(false);
		expect(await verifyPassword('anything', 'scrypt$only-two$')).toBe(false);
	});

	it('takes comparable time for a wrong password and an unparseable one', async () => {
		// Not a strict timing assertion — just proof that the unparseable path
		// still does the work, rather than returning early and leaking that the
		// account has no usable password.
		const stored = await hashPassword('right');
		const wrong = Date.now();
		await verifyPassword('wrong', stored);
		const wrongMs = Date.now() - wrong;
		const bad = Date.now();
		await verifyPassword('wrong', 'not-a-hash');
		const badMs = Date.now() - bad;
		expect(badMs).toBeGreaterThan(wrongMs / 4);
	});
});

describe('verifyPassword against a crafted stored value', () => {
	it('refuses a stored value whose key segment decodes to nothing', async () => {
		// The original bypass. '!!!' is a non-empty STRING that decodes to zero
		// BYTES, and a keylen derived from it made every password match.
		expect(await verifyPassword('any password at all', 'scrypt$AAAA$!!!')).toBe(false);
		expect(await verifyPassword('a different one', 'scrypt$AAAA$!!!')).toBe(false);
	});

	it('does not let an oversized stored value dictate how much work it does', async () => {
		// Measured: vulnerable 1316-1366ms, fixed 66-152ms. The bound sits between
		// them deliberately — widen it and this stops being a regression test.
		const huge = Buffer.alloc(10_000_000).toString('base64url');
		const started = Date.now();
		expect(await verifyPassword('any password at all', `scrypt$AAAA$${huge}`)).toBe(false);
		expect(Date.now() - started).toBeLessThan(600);
	});
});

describe('validatePassword', () => {
	it('accepts a password at the minimum length', () => {
		expect(validatePassword('a'.repeat(PASSWORD_MIN))).toHaveLength(PASSWORD_MIN);
	});

	it('rejects one character short', () => {
		expect(validatePassword('a'.repeat(PASSWORD_MIN - 1))).toBeNull();
	});

	it('rejects an absurdly long one, which would only burn CPU', () => {
		expect(validatePassword('a'.repeat(PASSWORD_MAX + 1))).toBeNull();
	});

	it('does not trim, because spaces are legitimate password characters', () => {
		const spaced = ' '.repeat(4) + 'abcdefgh';
		expect(validatePassword(spaced)).toBe(spaced);
	});

	it('rejects empty and non-string input', () => {
		expect(validatePassword('')).toBeNull();
		expect(validatePassword(null)).toBeNull();
	});
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/lib/server/auth/password.test.ts`
Expected: FAIL — cannot resolve `./password`.

- [ ] **Step 3: Write the implementation**

`src/lib/server/auth/password.ts`:

```ts
import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scryptAsync = promisify(scrypt) as (
	password: string,
	salt: Buffer,
	keylen: number,
	options: { N: number; r: number; p: number }
) => Promise<Buffer>;

/**
 * Deliberately slow. These are the Node defaults scaled for a Raspberry Pi 4:
 * roughly 100ms there, less on anything bigger. That cost is the point — it is
 * what makes an offline attack against a leaked hash expensive, and it doubles
 * as a natural brake on online guessing.
 */
const PARAMS = { N: 16384, r: 8, p: 1 };
const SALT_LEN = 16;
const KEYLEN = 64;
const SCHEME = 'scrypt';

export const PASSWORD_MIN = 8;
/** Not a security bound — a cap so nobody can burn CPU with a megabyte password. */
export const PASSWORD_MAX = 200;

export async function hashPassword(password: string): Promise<string> {
	const salt = randomBytes(SALT_LEN);
	const key = await scryptAsync(password, salt, KEYLEN, PARAMS);
	return `${SCHEME}$${salt.toString('base64url')}$${key.toString('base64url')}`;
}

/**
 * Always does the work, even when there is nothing to compare against. An early
 * return for a missing or malformed hash would take microseconds where a real
 * check takes ~100ms, which tells an attacker whether the account exists.
 *
 * **Never derive a length from the stored value.** An earlier version of this
 * function fed `expected.length` back into scrypt as the keylen, which made the
 * comparison below tautological — both sides were forced equal by construction.
 * A key segment of `'!!!'` decodes to zero bytes, scrypt returned zero bytes,
 * `timingSafeEqual(empty, empty)` was true, and **every password authenticated**.
 * That was a live authentication bypass. SALT_LEN and KEYLEN are our own
 * constants on both branches, and it is the DECODED lengths that are validated,
 * never the strings' — a non-empty string can decode to nothing.
 */
export async function verifyPassword(password: string, stored: string | null): Promise<boolean> {
	const parts = (stored ?? '').split('$');
	const tagged = parts.length === 3 && parts[0] === SCHEME;
	const salt = tagged ? Buffer.from(parts[1], 'base64url') : Buffer.alloc(0);
	const expected = tagged ? Buffer.from(parts[2], 'base64url') : Buffer.alloc(0);
	const usable = salt.length === SALT_LEN && expected.length === KEYLEN;
	// KEYLEN on both branches, so the work and the timing are identical whether
	// or not the stored value was usable.
	const actual = await scryptAsync(password, usable ? salt : randomBytes(SALT_LEN), KEYLEN, PARAMS);
	if (!usable) return false;
	return timingSafeEqual(actual, expected);
}

export function validatePassword(raw: FormDataEntryValue | null): string | null {
	// Not trimmed: a leading or trailing space is a legitimate password character,
	// and silently removing it would lock someone out of their own account.
	const password = typeof raw === 'string' ? raw : '';
	if (password.length < PASSWORD_MIN || password.length > PASSWORD_MAX) return null;
	return password;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/lib/server/auth/password.test.ts`
Report the count you observe, and the file's duration — scrypt is deliberately slow and this file will dominate the suite. If it exceeds about two seconds, say so.

- [ ] **Step 5: Commit**

```bash
git add src/lib/server/auth/password.ts src/lib/server/auth/password.test.ts
git commit -m "feat(auth): scrypt password hashing with no new dependency"
```

---

## Task 2: The schema

**Files:**
- Modify: `src/lib/server/db/schema.ts`, `src/lib/server/db/client.test.ts`
- Regenerated: `drizzle/0000_*.sql`, `drizzle/meta/`

**Interfaces:**
- Consumes: nothing.
- Produces: `users.username` (`NOT NULL`, unique), `users.passwordHash` (`NOT NULL`).

Migration `0000` is regenerated rather than added to — see the header. Nothing
has shipped, so there is no upgrade path to preserve.

- [ ] **Step 1: Write the failing test**

Append to `src/lib/server/db/client.test.ts`:

```ts
describe('user credentials', () => {
	it('refuses a user with no username', () => {
		const db = testDb();
		expect(() =>
			db
				.insert(users)
				.values({ displayName: 'Ada', passwordHash: 'x', loginTokenHash: 'h' } as never)
				.run()
		).toThrow();
	});

	it('refuses a user with no password hash', () => {
		const db = testDb();
		expect(() =>
			db
				.insert(users)
				.values({ displayName: 'Ada', username: 'ada', loginTokenHash: 'h' } as never)
				.run()
		).toThrow();
	});

	it('refuses two users with the same username', () => {
		const db = testDb();
		db.insert(users)
			.values({ displayName: 'Ada', username: 'ada', passwordHash: 'x', loginTokenHash: 'h1' })
			.run();
		expect(() =>
			db
				.insert(users)
				.values({ displayName: 'Other', username: 'ada', passwordHash: 'y', loginTokenHash: 'h2' })
				.run()
		).toThrow();
	});

	it('allows two users to share a display name', () => {
		const db = testDb();
		db.insert(users)
			.values({ displayName: 'Alex', username: 'alex1', passwordHash: 'x', loginTokenHash: 'h1' })
			.run();
		db.insert(users)
			.values({ displayName: 'Alex', username: 'alex2', passwordHash: 'y', loginTokenHash: 'h2' })
			.run();
		expect(db.select().from(users).all()).toHaveLength(2);
	});
});
```

The last one is the whole point of having two fields, so it is worth pinning
even though nothing enforces it — a future "helpful" unique index on
`display_name` would break the product decision, and this test would catch it.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/lib/server/db/client.test.ts`
Expected: FAIL — `username` and `passwordHash` are not on the schema.

- [ ] **Step 3: Extend the schema**

In `src/lib/server/db/schema.ts`, add to `users`, keeping every existing column
exactly as it is:

```ts
	/**
	 * What you sign in with. Deliberately separate from `displayName` (PRD §9,
	 * decision 20): two friends may both be "Alex" to the group, and either may
	 * change what the group calls them without changing how they log in.
	 */
	username: text('username').notNull().unique(),
	/**
	 * scrypt, in the format `scrypt$<salt>$<key>`. NOT NULL because every account
	 * in this design has a password — when v2 adds OIDC, provider-backed accounts
	 * will need this relaxed, inside a migration already doing more.
	 */
	passwordHash: text('password_hash').notNull(),
```

- [ ] **Step 4: Regenerate the migration**

```bash
rm -rf data drizzle/0000_*.sql drizzle/meta
npm run db:generate
```

**Verify and report:** the regenerated SQL still creates all twelve tables and
every unique constraint from before, plus `username` and `password_hash` as
`NOT NULL` with a unique index on `username`. Paste the `users` `CREATE TABLE`
and the index lines. If the table count is not twelve, stop and report —
something was lost.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npm test`. Every existing test that inserts a `users` row directly now
needs a `username` and a `passwordHash`. Fix those fixtures; do **not** weaken
any assertion to accommodate them. Report the count you observe and name every
test file you had to touch.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(auth): username and password_hash, required on every account"
```

---

## Task 3: Usernames and credentials in the user module

**Files:**
- Modify: `src/lib/server/users.ts`, `src/lib/server/users.test.ts`
- Modify: every `createUser` call site — `src/lib/server/setup.ts`, `src/routes/join/[token]/+page.server.ts`

**Interfaces:**
- Consumes: `hashPassword`, `verifyPassword` (Task 1); `username`, `passwordHash` columns (Task 2).
- Produces:
  - `USERNAME_MIN = 3`, `USERNAME_MAX = 32`
  - `validateUsername(raw: FormDataEntryValue | null): string | null` — normalises to lowercase
  - `createUser(db, input: { username: string; displayName: string; passwordHash: string; isAdmin?: boolean }): SessionUser`
  - `userByUsername(db: DB, username: string): { id: string; username: string; passwordHash: string } | null`
  - `setPassword(db: DB, userId: string, passwordHash: string): void`
  - `usernameTaken(db: DB, username: string): boolean`

**`createUser`'s signature changes from positional to an object.** It has two call sites and both are in this task. Positional arguments were fine at two parameters and are not at four, and the third and fourth are both optional — exactly the shape that produces a silent bug when someone passes them in the wrong order.

- [ ] **Step 1: Write the failing tests**

Append to `src/lib/server/users.test.ts`:

```ts
describe('validateUsername', () => {
	it('accepts a plain username and lowercases it', () => {
		expect(validateUsername('Ada')).toBe('ada');
	});

	it('trims surrounding whitespace', () => {
		expect(validateUsername('  ada  ')).toBe('ada');
	});

	it('accepts letters, digits, underscore, hyphen and dot', () => {
		expect(validateUsername('ada.l_1-x')).toBe('ada.l_1-x');
	});

	it('rejects characters that would be confusing in a URL or a log line', () => {
		expect(validateUsername('ada lovelace')).toBeNull();
		expect(validateUsername('ada@example.com')).toBeNull();
		expect(validateUsername('ada/../root')).toBeNull();
	});

	it('rejects non-ASCII, so two usernames cannot look identical', () => {
		// "аdа" here uses Cyrillic а. Allowing it would let one member register a
		// username visually indistinguishable from another's.
		expect(validateUsername('аdа')).toBeNull();
	});

	it('enforces the length bounds', () => {
		expect(validateUsername('ab')).toBeNull();
		expect(validateUsername('a'.repeat(USERNAME_MAX))).toHaveLength(USERNAME_MAX);
		expect(validateUsername('a'.repeat(USERNAME_MAX + 1))).toBeNull();
	});

	it('rejects empty and non-string input', () => {
		expect(validateUsername('')).toBeNull();
		expect(validateUsername(null)).toBeNull();
	});
});

describe('createUser with a username', () => {
	it('stores the username and the password hash', async () => {
		const hash = await hashPassword('correct horse battery');
		const user = createUser(db, { username: 'ada', displayName: 'Ada', passwordHash: hash });
		const row = db.select().from(users).where(eq(users.id, user.id)).get();
		expect(row?.username).toBe('ada');
		expect(row?.passwordHash).toBe(hash);
	});

	it('still allows two members to share a display name', async () => {
		const hash = await hashPassword('a password');
		createUser(db, { username: 'alex1', displayName: 'Alex', passwordHash: hash });
		expect(() =>
			createUser(db, { username: 'alex2', displayName: 'Alex', passwordHash: hash })
		).not.toThrow();
	});

	it('refuses two members with the same username', async () => {
		const hash = await hashPassword('a password');
		createUser(db, { username: 'ada', displayName: 'Ada', passwordHash: hash });
		expect(() =>
			createUser(db, { username: 'ada', displayName: 'Someone Else', passwordHash: hash })
		).toThrow();
	});
});

describe('userByUsername', () => {
	it('finds the account and returns what a login check needs', async () => {
		const hash = await hashPassword('secret password');
		const user = createUser(db, { username: 'ada', displayName: 'Ada', passwordHash: hash });
		expect(userByUsername(db, 'ada')).toEqual({
			id: user.id,
			username: 'ada',
			passwordHash: hash
		});
	});

	it('is case-insensitive, because the username is stored lowercased', async () => {
		createUser(db, {
			username: 'ada',
			displayName: 'Ada',
			passwordHash: await hashPassword('a password')
		});
		expect(userByUsername(db, 'ADA')?.username).toBe('ada');
	});

	it('returns null for an unknown username', async () => {
		createUser(db, {
			username: 'ada',
			displayName: 'Ada',
			passwordHash: await hashPassword('a password')
		});
		expect(userByUsername(db, 'grace')).toBeNull();
	});

	it('never returns the display name or anything else the login page does not need', async () => {
		createUser(db, {
			username: 'ada',
			displayName: 'Ada',
			passwordHash: await hashPassword('a password')
		});
		expect(Object.keys(userByUsername(db, 'ada') ?? {}).sort()).toEqual([
			'id',
			'passwordHash',
			'username'
		]);
	});
});

describe('setPassword', () => {
	it('replaces the stored hash', async () => {
		const user = createUser(db, {
			username: 'ada',
			displayName: 'Ada',
			passwordHash: await hashPassword('old password')
		});
		const fresh = await hashPassword('new password');
		setPassword(db, user.id, fresh);
		expect(userByUsername(db, 'ada')?.passwordHash).toBe(fresh);
	});

	it('leaves every other account untouched', async () => {
		const ada = createUser(db, {
			username: 'ada',
			displayName: 'Ada',
			passwordHash: await hashPassword('ada password')
		});
		const graceHash = await hashPassword('grace password');
		createUser(db, { username: 'grace', displayName: 'Grace', passwordHash: graceHash });
		setPassword(db, ada.id, await hashPassword('ada new password'));
		expect(userByUsername(db, 'grace')?.passwordHash).toBe(graceHash);
	});
});

describe('usernameTaken', () => {
	it('reports a username already in use', async () => {
		createUser(db, {
			username: 'ada',
			displayName: 'Ada',
			passwordHash: await hashPassword('a password')
		});
		expect(usernameTaken(db, 'ada')).toBe(true);
		expect(usernameTaken(db, 'grace')).toBe(false);
	});

	it('matches case-insensitively', async () => {
		createUser(db, {
			username: 'ada',
			displayName: 'Ada',
			passwordHash: await hashPassword('a password')
		});
		expect(usernameTaken(db, 'ADA')).toBe(true);
	});
});
```

The existing test `"gives two users with the same name different tokens"` will break — it calls `createUser(db, 'Ada')` positionally. Update it to the object form with two distinct usernames; the assertion it makes about token uniqueness is unchanged and still the point.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/lib/server/users.test.ts`
Expected: FAIL — `validateUsername` and friends are not exported, and the positional `createUser` calls no longer type-check.

- [ ] **Step 3: Write the implementation**

In `src/lib/server/users.ts`:

```ts
export const USERNAME_MIN = 3;
export const USERNAME_MAX = 32;

/**
 * Deliberately ASCII-only and lowercased. Two members must never be able to
 * hold usernames that look identical — allowing Unicode would let someone
 * register a Cyrillic "а" that renders exactly like the Latin one next to it,
 * and the whole point of this field is that it identifies exactly one account.
 * Display names have no such restriction: they are free-form and may collide.
 */
export function validateUsername(raw: FormDataEntryValue | null): string | null {
	const username = String(raw ?? '')
		.trim()
		.toLowerCase();
	if (username.length < USERNAME_MIN || username.length > USERNAME_MAX) return null;
	if (!/^[a-z0-9._-]+$/.test(username)) return null;
	return username;
}

export function createUser(
	db: DB,
	input: { username: string; displayName: string; passwordHash: string; isAdmin?: boolean }
): SessionUser {
	const id = crypto.randomUUID();
	const isAdmin = input.isAdmin ?? false;
	// A login token is minted so the column is never null; it is not shown
	// anywhere. The profile's reveal action regenerates it.
	db.insert(users)
		.values({
			id,
			username: input.username,
			displayName: input.displayName,
			passwordHash: input.passwordHash,
			isAdmin,
			loginTokenHash: hashToken(generateToken())
		})
		.run();
	return { id, displayName: input.displayName, isAdmin };
}

/**
 * Returns only what a credential check needs. The display name is deliberately
 * absent: the login page has no business knowing it before authentication, and
 * a narrower return is one fewer thing to leak into an error or a log.
 */
export function userByUsername(db: DB, username: string) {
	const row = db
		.select({ id: users.id, username: users.username, passwordHash: users.passwordHash })
		.from(users)
		.where(eq(users.username, username.trim().toLowerCase()))
		.get();
	return row && row.username ? { id: row.id, username: row.username, passwordHash: row.passwordHash } : null;
}

export function setPassword(db: DB, userId: string, passwordHash: string): void {
	db.update(users).set({ passwordHash }).where(eq(users.id, userId)).run();
}

export function usernameTaken(db: DB, username: string): boolean {
	return userByUsername(db, username) !== null;
}
```

- [ ] **Step 4: Update both call sites**

`src/lib/server/setup.ts` — `claimInstance` gains a username and a password hash. Its signature becomes `claimInstance(db, input: { username: string; displayName: string; passwordHash: string; timezone: string })`, and the whole test-and-set stays inside the existing transaction. **The hashing happens in the route, before the transaction** — `hashPassword` is async, and an `await` inside the transaction would break the atomicity the transaction exists for.

`src/routes/join/[token]/+page.server.ts` — Task 4 rewrites this properly; for now just make it compile with the object form.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npm test`. Report the count you observe.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(auth): usernames, credential lookup and password storage"
```

---

## Task 4: Joining with a username and a password

**Files:**
- Modify: `src/routes/join/[token]/+page.server.ts`, `src/routes/join/[token]/+page.svelte`
- Modify: `src/routes/setup/+page.server.ts`, `src/routes/setup/+page.svelte`
- Modify: `src/lib/i18n/en.json`, `src/lib/i18n/de.json`

**Interfaces:**
- Consumes: `validateUsername`, `usernameTaken`, `createUser` (Task 3); `hashPassword`, `validatePassword` (Task 1); `redeemInvite`, `lookupInvite` (Plan 1).
- Produces: a join flow that creates an account with a username, display name and password; and a setup screen that does the same for the instance admin.

- [ ] **Step 1: Add the translation keys**

To `src/lib/i18n/en.json`:

```json
	"auth.username": "Username",
	"auth.username_hint": "Letters, digits, dot, dash and underscore. This is what you sign in with.",
	"auth.display_name": "Shown to the group as",
	"auth.display_name_hint": "Change this any time. It does not have to be unique.",
	"auth.password": "Password",
	"auth.password_hint": "At least 8 characters.",
	"auth.password_repeat": "Repeat password",
	"auth.error.username": "Pick a username of 3 to 32 characters, using only letters, digits, dot, dash or underscore.",
	"auth.error.username_taken": "That username is already taken.",
	"auth.error.password": "Your password needs at least 8 characters.",
	"auth.error.password_mismatch": "The two passwords do not match."
```

To `src/lib/i18n/de.json`:

```json
	"auth.username": "Benutzername",
	"auth.username_hint": "Buchstaben, Ziffern, Punkt, Bindestrich und Unterstrich. Damit meldest du dich an.",
	"auth.display_name": "Der Gruppe angezeigt als",
	"auth.display_name_hint": "Jederzeit änderbar. Muss nicht eindeutig sein.",
	"auth.password": "Passwort",
	"auth.password_hint": "Mindestens 8 Zeichen.",
	"auth.password_repeat": "Passwort wiederholen",
	"auth.error.username": "Wähle einen Benutzernamen mit 3 bis 32 Zeichen, nur Buchstaben, Ziffern, Punkt, Bindestrich oder Unterstrich.",
	"auth.error.username_taken": "Dieser Benutzername ist schon vergeben.",
	"auth.error.password": "Dein Passwort braucht mindestens 8 Zeichen.",
	"auth.error.password_mismatch": "Die beiden Passwörter stimmen nicht überein."
```

- [ ] **Step 2: Rewrite the join action**

The order below is not arbitrary. Hashing is the expensive step and must not run for a request that was going to fail anyway, and the invite check must sit past the last `await` so it cannot be raced:

```ts
	default: async ({ request, params, cookies, getClientAddress, locals, url }) => {
		if (!rateLimit(`join:${getClientAddress()}`, 20, 60_000)) {
			return fail(429, { error: 'invite.rate_limited' });
		}

		// A signed-in visitor joins as themselves. A second account would split
		// their suggestions, ratings and history across two identities, and Plan 5's
		// fairness-weighted draw would count them as two different people.
		// redeemInvite does its own lookup and nothing here is async.
		if (locals.user) {
			const joinedGroupId = redeemInvite(db, params.token, locals.user.id);
			if (!joinedGroupId) return fail(410, { error: 'invite.invalid' });
			redirect(303, `/groups/${joinedGroupId}`);
		}

		// Authorization, and deliberately above anything that reveals instance
		// state: without a valid invite a visitor must not be able to learn whether
		// a username exists. The lookup below, past the last await, stays the
		// authoritative freshness check. Check twice — see FIX 8 in the movie-pool
		// decisions. Someone HOLDING a valid invite can still tell a taken username
		// from a free one; that is intended, since they can join and read the
		// member list anyway.
		if (!lookupInvite(db, params.token)) return fail(410, { error: 'invite.invalid' });

		const form = await request.formData();
		const username = validateUsername(form.get('username'));
		if (!username) return fail(400, { error: 'auth.error.username' });
		const displayName = validateDisplayName(form.get('displayName'));
		if (!displayName) return fail(400, { error: 'invite.error.name' });
		const password = validatePassword(form.get('password'));
		if (!password) return fail(400, { error: 'auth.error.password' });
		if (password !== form.get('passwordRepeat')) {
			return fail(400, { error: 'auth.error.password_mismatch' });
		}

		// Cheap rejection before the expensive hash: a taken username is by far
		// the most common failure here, and hashing first would burn ~100ms of
		// CPU on every one of them.
		if (usernameTaken(db, username)) return fail(400, { error: 'auth.error.username_taken' });

		const passwordHash = await hashPassword(password);

		// Past the last await. The invite lookup, the account creation and the
		// redemption are now one uninterruptible sequence, which is what stops a
		// second tab from racing an invite that is expiring or filling up.
		const invite = lookupInvite(db, params.token);
		if (!invite) return fail(410, { error: 'invite.invalid' });

		const user = createUser(db, { username, displayName, passwordHash });
		const joinedGroupId = redeemInvite(db, params.token, user.id);
		if (!joinedGroupId) return fail(410, { error: 'invite.invalid' });

		const { token, expiresAt } = createSession(db, user.id);
		setSessionCookie(cookies, token, expiresAt, url.protocol === 'https:');
		redirect(303, `/groups/${joinedGroupId}`);
	}
```

Note the `usernameTaken` check is a convenience, not the guarantee — the unique index is. A race between two people claiming the same username at the same instant surfaces as `SQLITE_CONSTRAINT_UNIQUE` from `createUser`. Catch that specific code and return the same translated `auth.error.username_taken`, and rethrow every other error — an uncaught constraint violation renders a SvelteKit 500, which is a worse answer than the message the non-racing path already gives. The check exists so the common case never reaches the constraint at all.

- [ ] **Step 3: Add the fields to both forms**

The join page and the setup page now ask for the same three things. Each field needs a `min-h-11` input, a label, and its hint. The password fields use `type="password"` and `autocomplete="new-password"`; the username uses `autocomplete="username"`.

The setup action changes the same way: validate, check taken, hash, then `claimInstance` with the hash inside its transaction.

- [ ] **Step 4: Verify and commit**

Run `npm run lint && npm run check && npm test && npm run build`, then **by hand on port 5599** from a fresh `rm -rf data`: complete setup with a username and password, confirm you land signed in; create a group and an invite; open the invite in a private window and join with a *different* username but the **same display name**, and confirm both succeed and both appear in the member list. Then try to join with a username already taken and confirm the translated message.

```bash
git add -A
git commit -m "feat(auth): join and setup ask for a username and a password"
```

---

## Task 5: The login form

This is the security-critical task of the plan. Read the two new Global Constraints before starting.

**Files:**
- Create: `src/routes/login/+page.server.ts`, `src/routes/login/+page.svelte`, `src/routes/login/login.test.ts`
- Modify: `src/lib/i18n/en.json`, `src/lib/i18n/de.json`

**Interfaces:**
- Consumes: `userByUsername` (Task 3); `verifyPassword` (Task 1); `createSession`, `setSessionCookie` (Plan 1); `rateLimit` (Plan 1).
- Produces: `/login`, sitting alongside the existing `/login/[token]` without disturbing it.

**Two properties this task exists to get right.**

**No user enumeration.** A wrong username and a wrong password must be indistinguishable in body, status **and timing**. `scrypt` takes about 100ms; returning early when the username is unknown would take microseconds, and that difference is a reliable oracle for "does this person have an account here". So the handler calls `verifyPassword` **unconditionally**, passing `null` when there is no such user — Task 1's implementation hashes against random bytes in that case specifically so the timing matches.

**The rate limit may not be keyed on the username alone.** `rate-limit.ts` shares one global map that evicts the oldest window by insertion order once it is full. A username-keyed limiter lets an attacker mint 10,000 fake usernames and evict live windows — any live window, since eviction does not care whose key it is. So:

- **`login-ip:<address>` is the primary gate**, checked first and always — not because it cannot be evicted (it can; it sits in the same map under the same rule) but because an attacker cannot *expand* its key space: one key per source address, where they can mint usernames at will.
- **`login-user:<username>` is defence in depth** against a distributed attack on one account. It is evictable under flood, and that is an accepted degradation rather than a bypass, because the IP gate still holds.

Check both. Never the username alone.

**Record the lockout trade-off rather than absorbing it.** A blocking username gate means ten failures in five minutes keeps a known user out of their own account, and `rateLimit` consumes atomically so there is no check-without-consume variant to reach for. It is still the right call here — refusing the work *before* `scrypt` runs is what stops CPU exhaustion — but put a comment at that gate naming both the trade-off and the upgrade path (letting a correct password through the username gate, if lockout ever bites in practice). It must not read as an oversight.

- [ ] **Step 1: Add the translation keys**

To `src/lib/i18n/en.json`:

```json
	"login.title": "Sign in",
	"login.submit": "Sign in",
	"login.failed": "That username and password do not match.",
	"login.rate_limited": "Too many attempts. Try again in a minute.",
	"login.forgot": "Forgotten your password? Use your personal login link from a device where you are still signed in."
```

To `src/lib/i18n/de.json`:

```json
	"login.title": "Anmelden",
	"login.submit": "Anmelden",
	"login.failed": "Benutzername und Passwort passen nicht zusammen.",
	"login.rate_limited": "Zu viele Versuche. Versuch es in einer Minute erneut.",
	"login.forgot": "Passwort vergessen? Nimm deinen persönlichen Login-Link von einem Gerät, auf dem du noch angemeldet bist."
```

`login.failed` is deliberately one message for both failure modes. Do not add a separate "no such user" string — the whole point is that they are indistinguishable.

- [ ] **Step 2: Write the failing test**

`src/routes/login/login.test.ts` — a route-level test, following the pattern established by `add/page.server.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { applyMigrations, createDb, type DB } from '$lib/server/db/client';
import { hashPassword } from '$lib/server/auth/password';
import { createUser } from '$lib/server/users';
import { resetRateLimits } from '$lib/server/rate-limit';

let db: DB;
vi.mock('$lib/server/db', () => ({ get db() { return db; } }));

async function post(fields: Record<string, string>, address = '1.2.3.4') {
	const { actions } = await import('./+page.server');
	const request = new Request('http://localhost/login', {
		method: 'POST',
		body: new URLSearchParams(fields)
	});
	return actions.default({
		request,
		cookies: { set: vi.fn(), get: vi.fn(), delete: vi.fn() },
		getClientAddress: () => address,
		url: new URL('http://localhost/login')
	} as never);
}

beforeEach(async () => {
	db = createDb(':memory:').db;
	applyMigrations(db);
	resetRateLimits();
	createUser(db, {
		username: 'ada',
		displayName: 'Ada',
		passwordHash: await hashPassword('correct horse battery')
	});
});

describe('POST /login', () => {
	it('rejects a wrong password', async () => {
		const result = await post({ username: 'ada', password: 'wrong password' });
		expect(result?.data?.error).toBe('login.failed');
	});

	it('gives an unknown username the identical message', async () => {
		const unknown = await post({ username: 'grace', password: 'whatever it is' });
		const wrong = await post({ username: 'ada', password: 'wrong password' }, '5.6.7.8');
		expect(unknown?.data?.error).toBe(wrong?.data?.error);
		expect(unknown?.status).toBe(wrong?.status);
	});

	it('takes comparable time for an unknown username and a wrong password', async () => {
		// The point of the dummy hash in verifyPassword. A fast path for "no such
		// user" would tell an attacker which accounts exist.
		//
		// Warmed up first, and medians rather than single samples. The very first
		// request through this action costs ~45ms of one-off module and JIT work,
		// which is by itself enough to make a microsecond-fast early return look
		// like a real hash. THIS TEST WAS ORIGINALLY WRITTEN COLD AND PASSED
		// AGAINST AN IMPLEMENTATION THAT RETURNED EARLY ON AN UNKNOWN USERNAME
		// (unknown 45ms vs wrong 91ms, clearing wrongMs/4 on one-off cost alone).
		// Do not simplify it back.
		await post({ username: 'warm-up', password: 'whatever it is' }, '203.0.113.1');

		const time = async (fields: Record<string, string>, address: string) => {
			const started = performance.now();
			await post(fields, address);
			return performance.now() - started;
		};
		const median = (xs: number[]) => xs.sort((x, y) => x - y)[Math.floor(xs.length / 2)];

		const unknown: number[] = [];
		const wrong: number[] = [];
		for (let i = 0; i < 3; i++) {
			unknown.push(await time({ username: `nobody-${i}`, password: 'whatever' }, `198.51.100.${i}`));
			wrong.push(await time({ username: 'ada', password: 'wrong password' }, `203.0.113.${i + 2}`));
		}

		// Half, not a quarter: scrypt dominates both paths, so the honest gap is a
		// few percent, while an early return leaves ~1ms against ~90ms.
		expect(median(unknown)).toBeGreaterThan(median(wrong) / 2);
	});

	it('signs in with the correct username and password', async () => {
		// Without this, every other test in this file passes against an action
		// whose whole body is `return fail(400, { error: 'login.failed' })`. A
		// suite in which nobody can ever sign in was 100% green.
		//
		// Note `redirect()` THROWS rather than returning, so a success cannot be
		// asserted off `post()`'s return value the way a `fail()` can. Catch it
		// and check `isRedirect`, or wrap it in a helper that does.
		const { redirect, cookies } = await postExpectRedirect({
			username: 'ada',
			password: 'correct horse battery'
		});
		expect(redirect.status).toBe(303);
		expect(redirect.location).toBe('/groups');
		// Assert the cookie FLAGS here too, not just that a cookie was set —
		// `secure` in particular. See the Global Constraints: shipping
		// `secure: !dev` once made an instance permanently unreachable over
		// plain HTTP, and with Step 6 routing every signed-out visitor through
		// /login there is no longer another way in.
		expect(cookies.set).toHaveBeenCalledWith(
			SESSION_COOKIE,
			expect.any(String),
			expect.objectContaining({ httpOnly: true, secure: false })
		);
	});

	it('rate-limits by address before it ever looks the account up', async () => {
		// A different username every time, so only the address budget is spent and
		// this can only pass if the ADDRESS gate fired.
		for (let i = 0; i < 10; i++) await post({ username: `nobody-${i}`, password: 'wrong' });
		const result = await post({ username: 'ada', password: 'correct horse battery' });
		// Even the correct password is refused once the address is over budget.
		expect(result?.data?.error).toBe('login.rate_limited');
	});

	it('does not let one address exhaust another address budget', async () => {
		// NOT 'ada': flooding her name would exhaust login-user:ada as well, and
		// the username gate would answer first.
		for (let i = 0; i < 10; i++) await post({ username: 'nobody-at-all', password: 'wrong' }, '1.1.1.1');
		const result = await post({ username: 'ada', password: 'wrong password' }, '2.2.2.2');
		expect(result?.data?.error).toBe('login.failed');
	});

	it('limits one account even when each attempt comes from a new address', async () => {
		// Every address fresh, so only the USERNAME gate can produce this.
		for (let i = 0; i < 10; i++) await post({ username: 'ada', password: 'wrong' }, `10.0.0.${i}`);
		const result = await post({ username: 'ada', password: 'wrong password' }, '10.0.0.99');
		expect(result?.data?.error).toBe('login.rate_limited');
	});
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npx vitest run src/routes/login/login.test.ts`
Expected: FAIL — `./+page.server` does not exist.

- [ ] **Step 4: Write the route**

`src/routes/login/+page.server.ts`:

```ts
import { verifyPassword } from '$lib/server/auth/password';
import { createSession, setSessionCookie } from '$lib/server/auth/session';
import { db } from '$lib/server/db';
import { rateLimit } from '$lib/server/rate-limit';
import { safeRedirectPath } from '$lib/server/redirect';
import { userByUsername, validateUsername } from '$lib/server/users';
import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = ({ locals, url }) => {
	if (locals.user) redirect(303, '/groups');
	// '/groups', not safeRedirectPath's default '/': otherwise every plain
	// sign-in takes a pointless extra hop through a page that only redirects.
	return { redirectTo: safeRedirectPath(url.searchParams.get('redirectTo'), '/groups') };
};

export const actions: Actions = {
	default: async ({ request, cookies, getClientAddress, url }) => {
		// The address gate is primary and is checked first: it is the one an
		// attacker cannot evict, because it does not depend on a key they choose.
		if (!rateLimit(`login-ip:${getClientAddress()}`, 10, 60_000)) {
			return fail(429, { error: 'login.rate_limited' });
		}

		const form = await request.formData();
		// validateUsername rather than a bare trim/lowercase: it bounds what can
		// become a `login-user:` rate-limit key below to 32 characters. A raw form
		// value is attacker-controlled and unbounded — with a 512KB body and
		// MAX_WINDOWS = 10_000 that is multi-gigabyte growth in the process-wide
		// window map. An unusable username becomes '', which no account can hold,
		// so it takes the same path and the same ~100ms as any other wrong guess.
		const username = validateUsername(form.get('username')) ?? '';
		const password = String(form.get('password') ?? '');

		// Defence in depth against a distributed attack on one account. Evictable
		// under a key flood, which is why it is second and not instead.
		if (username && !rateLimit(`login-user:${username}`, 10, 300_000)) {
			return fail(429, { error: 'login.rate_limited' });
		}

		const account = userByUsername(db, username);
		// Called unconditionally, including when there is no such account:
		// returning early here would take microseconds where a real check takes
		// ~100ms, and that difference tells an attacker which usernames exist.
		const ok = await verifyPassword(password, account?.passwordHash ?? null);
		if (!account || !ok) return fail(400, { error: 'login.failed' });

		// Past the last await.
		const { token, expiresAt } = createSession(db, account.id);
		setSessionCookie(cookies, token, expiresAt, url.protocol === 'https:');
		redirect(303, safeRedirectPath(form.get('redirectTo'), '/groups'));
	}
};
```

`safeRedirectPath` takes a fallback, so a signed-in visitor lands on `/groups` rather than `/`. Confirm its signature accepts one; if not, pass `'/groups'` explicitly at the call site rather than changing the helper.

- [ ] **Step 5: Write the page**

A plain form: username, password, submit, and the `login.forgot` line. It **must** carry `<input type="hidden" name="redirectTo" value={data.redirectTo} />` — `load` computes `redirectTo` and the action reads it from the form, so without this field it is always null and every login lands on `/groups`, silently discarding the deep link. No JavaScript. `autocomplete="username"` and `autocomplete="current-password"`, `min-h-11` on both inputs and the button, `role="alert"` on the error.

- [ ] **Step 6: Point signed-out visitors at it**

`src/routes/+page.server.ts` currently renders a near-empty page for a signed-out visitor, because there was nowhere to send them. Now there is: redirect to `/login`. Update `home.no_groups` copy if it no longer fits.

- [ ] **Step 7: Verify and commit**

Run the full gates, then **by hand on port 5599** from a fresh `rm -rf data`: complete setup, sign out, sign in with the username and password. Then try a wrong password, a username that does not exist, and confirm the message is **identical**. Then submit eleven wrong passwords in a row and confirm the eleventh says rate-limited rather than failed.

```bash
git add -A
git commit -m "feat(auth): username and password login without an enumeration oracle"
```

---

## Task 6: The profile

**Files:**
- Modify: `src/routes/profile/+page.server.ts`, `src/routes/profile/+page.svelte`
- Modify: `src/lib/server/db/schema.ts` (email gains `.unique()`), regenerate the migration
- Modify: `src/lib/i18n/en.json`, `src/lib/i18n/de.json`

**Interfaces:**
- Consumes: `setPassword`, `validateDisplayName` (Task 3); `hashPassword`, `verifyPassword`, `validatePassword` (Task 1); `deleteOtherSessions` (Plan 1).
- Produces: change password, change display name, set or clear email. Plus the existing reveal-login-link action, unchanged.

**The username is not editable in this plan.** Changing it frees the old one for someone else to claim, which is a real impersonation vector in a group that identifies people by it, and it invalidates every saved credential. That deserves its own decision rather than riding along here — record it as deferred rather than implementing it quietly.

**Changing a password requires the current one**, even though the user is already signed in. A session cookie proves someone is at the keyboard; it does not prove it is the account's owner rather than someone who sat down at their unlocked laptop.

**Changing a password signs out every other session.** `deleteOtherSessions` already exists and does exactly this for the login-link reveal. A password change is the other moment where "I think someone else has access" is the reason you are here.

- [ ] **Step 1: Add the translation keys**

English:

```json
	"profile.change_password": "Change password",
	"profile.current_password": "Current password",
	"profile.new_password": "New password",
	"profile.password_changed": "Password changed. Every other device has been signed out.",
	"profile.email": "Email address",
	"profile.email_hint": "Optional. Used only to reset your password, and only if this instance can send mail.",
	"profile.email_saved": "Email address saved.",
	"profile.display_name_saved": "Display name updated.",
	"profile.error.current_password": "That is not your current password.",
	"profile.error.email": "That does not look like an email address."
```

German:

```json
	"profile.change_password": "Passwort ändern",
	"profile.current_password": "Aktuelles Passwort",
	"profile.new_password": "Neues Passwort",
	"profile.password_changed": "Passwort geändert. Alle anderen Geräte wurden abgemeldet.",
	"profile.email": "E-Mail-Adresse",
	"profile.email_hint": "Optional. Wird nur zum Zurücksetzen deines Passworts verwendet, und nur wenn diese Instanz Mail versenden kann.",
	"profile.email_saved": "E-Mail-Adresse gespeichert.",
	"profile.display_name_saved": "Anzeigename aktualisiert.",
	"profile.error.current_password": "Das ist nicht dein aktuelles Passwort.",
	"profile.error.email": "Das sieht nicht nach einer E-Mail-Adresse aus."
```

- [ ] **Step 2: Add the three actions**

`changePassword` — **rate-limit first**, keyed on the user id: `rateLimit(`password-change:${locals.user.id}`, 5, 300_000)`, returning `profile.rate_limited`. The current-password check is the only barrier between a borrowed session and a permanent takeover, and an ungated form lets it be guessed freely. A user id is a safe key here — the caller cannot mint more of them, so this limiter cannot be used to flood the shared map, unlike the submitted username that constrains the login limiter. That is a statement about causing eviction, not about surviving it: every window in that map is evictable oldest-first, user ids included. Do not write that a key "cannot be evicted". Then verify the current password against the stored hash (there is no branch to skip here; the enumeration-timing reasoning from login does **not** apply, because the account is already known — keep the behaviour but do not repeat that justification, or someone will later "optimise" it away), validate the new one, confirm it matches the repeat, hash it, `setPassword`, then `deleteOtherSessions` keeping this one.

`changeDisplayName` — `validateDisplayName`, update. No uniqueness check; duplicates are allowed by design.

`setEmail` — accept an empty value as "clear it", otherwise a minimal shape check. **Do not** write a clever email regex: the only definitive test of an address is sending to it, which is Plan 4's job. Something of the form `x@y.z` with no spaces is the right level of strictness here, and the plan should say so rather than leaving the next person to invent RFC 5322.

**Email must be unique, and the constraint alone is not enough.** Plan 4 resolves an address back to one account to send a reset link, which is ambiguous the moment two people set the same address. Verified against better-sqlite3: `UNIQUE` on a nullable column permits many NULLs (so an optional email still works) and rejects duplicates with `SQLITE_CONSTRAINT_UNIQUE` — but it accepts `Ada@x.com` alongside `ada@x.com`. So both halves are required: `.unique()` in the schema, **and** `setEmail` lowercasing and trimming before it writes. Catch the constraint violation and return a new `profile.error.email_taken` in both locales rather than rendering a 500; rethrow anything else. That error does confirm the address has an account on this instance — acceptable for a private 3–12 person group, and worth the usability, but say so in a comment so it reads as a decision.

Each action returns its own success key so the page can say what happened.

- [ ] **Step 3: Render them**

Three small forms plus the existing reveal-login-link one. Show the username as read-only text with a note that it cannot be changed.

- [ ] **Step 4: Verify and commit**

Full gates, then by hand on port 5599: change the display name and see it in the group member list; set an email and reload to confirm it persisted; change the password with the wrong current password and confirm the error; change it correctly, confirm the message, and confirm a second signed-in browser is now signed out while this one is not.

```bash
git add -A
git commit -m "feat(auth): change password, display name and email from the profile"
```

---

## Self-review

**Spec coverage.** PRD §9 as rewritten: username and password login (Tasks 3–5), invite-only registration preserved (Task 4), `scrypt` from the standard library with no new dependency (Task 1), the personal login link retained as the no-SMTP recovery (untouched from Plan 1, and Task 6 keeps its reveal action). §12's revised privacy line: optional email, used for nothing yet (Task 6). §14 decision #20: separate username and display name (Tasks 3–4).

**Deliberately not here:** SMTP and the emailed password reset — that is Plan 4, and this plan must not make login depend on it. Username changes, recorded as deferred in Task 6. OIDC, still v2.

**Open risk to watch.** `scrypt` at these parameters takes roughly 100ms on a Raspberry Pi 4, and it now runs on every login, every join and every password change. That is the cost that makes the hash worth having, but it means the login handler holds a worker for 100ms. At twelve users this is irrelevant; if the suite's duration jumps noticeably in Task 1, say so rather than tuning the parameters down silently — the right response is a decision, not a quiet weakening.

## Plan sequence

| Plan | Delivers | Depends on |
| --- | --- | --- |
| 1. Foundation & access | Setup, groups, invites, login links, i18n, schema, migrations | — |
| 2. Movie pool | TMDB search, manual entry, dedupe, anonymous pool grid, withdraw, cap | 1 |
| **3. Username & password** (this one) | Username, `scrypt` passwords, login form, profile credential management | 1 |
| 4. SMTP & password reset | Optional SMTP, short-lived single-use reset tokens, the forgot-password flow | 3 |
| 5. Nights & the draw | Scheduling, RSVP, four states, fairness-weighted draw, seeded log, 1000-night simulation | 1, 2 |
| 6. Ratings | Window arithmetic, blind submission, reveal, average and spread | 1, 5 |
| 7. Ship it | Multi-arch Docker on glibc, compose, CI, README/LICENSE, backup command, a11y pass | 1–6 |
