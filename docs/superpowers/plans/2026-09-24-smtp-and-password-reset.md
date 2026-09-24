# Optional SMTP and password reset — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give a member who has forgotten their password a way back into their account — by email where the operator configured SMTP, and by the instance admin where they did not — without ever making a mail server a prerequisite for logging in.

**Architecture:** One new `password_resets` table holding SHA-256 hashes of 128-bit tokens, short-lived and single-use, exactly like every other token in this codebase. Two routes consume it: `/reset` requests a link by email, `/reset/<token>` sets the new password. A third producer, `/admin`, mints the same token for a member and shows it to the admin once, which is what closes the gap Plan 3 opened without involving mail at all. `nodemailer` is the only new dependency.

**Tech Stack:** SvelteKit 2 / Svelte 5 runes, better-sqlite3 + Drizzle, Vitest, `nodemailer@10` (zero runtime dependencies — verified with `npm view nodemailer dependencies`, which returns nothing).

**Spec:** `prd.md` — §9 (recovery), §10 (tokens), §11 (deployment, env-only config), §12 (privacy, the SMTP rule), and decision 21 in §14.

---

## Global Constraints

Every task's requirements implicitly include this section.

- **Login never depends on SMTP** (PRD §12, verbatim): *"Email is allowed to make recovery nicer; it is never allowed to be the thing standing between a member and their account."* An instance with no SMTP must lose nothing except the emailed convenience. **Task 5 is what makes this true again** — it is not optional polish.
- **Configuration exclusively through environment variables** (PRD §11). No config file, no settings table, no UI for SMTP.
- **Tokens are 128-bit, stored as SHA-256 hashes, never in plaintext** (PRD §10). Reuse `generateToken()` and `hashToken()` from `src/lib/server/auth/tokens.ts`. Do not invent a second scheme.
- **A password reset is a revocation path, so it must revoke every credential.** Plan 3's Major finding was exactly this shape: a password change rotated the password and swept sessions but left the personal login link alive, so an attacker who had revealed one kept access through a change the victim was told had locked them out. A reset must set the password, sweep **every** session (there is no session to keep — the caller is not signed in), **and** rotate `users.login_token_hash`. Consuming the reset token is a fourth, separate thing.
- **No user enumeration, anywhere.** `/reset` must answer identically whether or not the address has an account, and whether or not SMTP is configured differently only in the *static* copy the page renders, never in the response to a submission. A wrong token and an expired token must be indistinguishable.
- **Rate limiting: the address-keyed gate is primary and always checked first.** `rate-limit.ts` evicts oldest-first by insertion order and every key in it is evictable, IP-keyed ones included — the property that matters is that an attacker cannot *expand* the IP key space, where they can mint email addresses at will. A secondary gate keyed on the submitted address is defence in depth, never the only gate. Read the comment in `rate-limit.ts` before writing either.
- **Secrets must not escape in errors.** An SMTP failure carries host, user and sometimes the password in the error or its `.response`. Plan 2 hit the identical class with the TMDB key in a URL and fixed it by sanitising at the boundary with a bare `catch {}` that discards the original. Do the same here: nothing from a mail error reaches a log line, a response body, or a thrown error that SvelteKit will render.
- **Cookie `secure` is `url.protocol === 'https:'`, never `!dev`.** That bug once made an instance permanently unreachable.
- **Any claim about cookies, CSRF, origin handling or transport must be verified against `node build/index.js`, never `vite dev`.** SvelteKit skips the CSRF origin check entirely under the dev server, and `vite dev` has already concealed two separate security properties from this project.
- **Pin behaviour to error classes and status codes, not to message strings.** A fix resting on `err.message.includes(...)` can be silently reverted by a dependency bump with the suite still green.
- **Test discipline.** Baseline is **296 tests in 25 files** — run the suite, never predict the count. Every test asserting a security property must be *seen to fail*: break the behaviour it names, confirm red, restore, confirm green, and report it. Measure timing warm and compare medians — a cold measurement in this project once passed against a vulnerable implementation because ~45ms of one-off JIT cost cleared the threshold by itself. And assert the happy path: a file that specifies only failure modes passes when the feature is entirely absent, which has already happened here once.

## Review Focus

Five things the spec implies, that no task's own happy-path tests would exercise, most likely to bite first. Each gets a test in the task that owns the code.

1. **SMTP configured but unreachable.** The operator typo'd the host, or the mail server is down. The request must not hang the page, must not render a stack trace, and must answer *identically* to a successful send — otherwise reachability becomes an oracle for which addresses exist. → Task 3.
2. **A reset token used twice.** The second use must fail, and fail the same way an invented token does. A reset link sits in a mailbox forever; single-use is the only thing that bounds it. → Task 4.
3. **The email address changes between minting and using a token.** The member requests a reset, then changes their address — or an attacker who has a session changes it. The token must still resolve to the *account*, and rotating the password must not be blockable by whoever last touched the email column. → Task 4.
4. **SMTP credentials inside an error.** Mail libraries put the host, the user, and sometimes the password into `err.response`. Nothing from a mail failure may reach a response body, a rendered error, or a log line. → Task 1.
5. **An expired token at the boundary.** Exactly at, and one millisecond past, the TTL. Off-by-one here means either a token that never works or one that outlives its window. → Task 2.

---

## File Structure

| File | Responsibility |
| --- | --- |
| `src/lib/server/mail.ts` | Reads SMTP env, reports whether mail is configured, sends one message. The only file that imports `nodemailer`. |
| `src/lib/server/mail.test.ts` | Config parsing, the not-configured case, and secret redaction on failure. |
| `src/lib/server/db/schema.ts` | Adds `password_resets`. |
| `src/lib/server/resets.ts` | Mint, resolve and consume a reset token. No HTTP, no mail. |
| `src/lib/server/resets.test.ts` | Lifecycle, TTL boundary, single use. |
| `src/routes/reset/+page.server.ts` / `+page.svelte` / `reset.test.ts` | Request a reset. Enumeration-safe. |
| `src/routes/reset/[token]/+page.server.ts` / `+page.svelte` / `reset-token.test.ts` | Complete a reset. Revokes everything. |
| `src/routes/admin/+page.server.ts` / `+page.svelte` / `admin.test.ts` | Admin-only. Mints a recovery link for a member with no mail involved. |
| `src/lib/i18n/en.json`, `de.json` | Copy for all of the above. |
| `prd.md` | §9 and §12 updated: the recorded gap is closed. |

---

## Task 1: The mail transport

**Files:**
- Create: `src/lib/server/mail.ts`, `src/lib/server/mail.test.ts`
- Modify: `package.json` (add `nodemailer`, `@types/nodemailer`), `.env.example` if one exists — create it if not

**Interfaces:**
- Produces: `isMailConfigured(): boolean`; `sendMail(to: string, subject: string, body: string): Promise<boolean>` — resolves `true` on a successful send, `false` on **any** failure, and never throws or rejects.

**Why `sendMail` swallows everything.** Its caller is an enumeration-safe route that must answer identically whether the address existed, whether mail is configured, and whether the server was reachable. A caller that has to distinguish those cases will eventually leak one. The failure is recorded for the operator through a single redacted line and nowhere else.

- [ ] **Step 1: Add the dependency**

```bash
npm install nodemailer
npm install -D @types/nodemailer
```

`nodemailer` has zero runtime dependencies — confirm with `npm view nodemailer dependencies`, which prints nothing. That is why it is acceptable in a project that hand-rolled its password hashing: the cost this codebase refuses is a dependency *tree*, and SMTP with STARTTLS, AUTH and MIME encoding is several hundred lines of protocol handling with real failure modes, not the "few lines" that would make a dependency the lazy choice.

- [ ] **Step 2: Write the failing test**

`src/lib/server/mail.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from 'vitest';

const ORIGINAL = { ...process.env };
afterEach(() => {
	process.env = { ...ORIGINAL };
	vi.resetModules();
	vi.restoreAllMocks();
});

async function loadMail(env: Record<string, string | undefined>) {
	process.env = { ...ORIGINAL, ...env };
	vi.resetModules();
	return import('./mail');
}

describe('isMailConfigured', () => {
	it('is false when no SMTP host is set', async () => {
		const { isMailConfigured } = await loadMail({ SMTP_HOST: undefined });
		expect(isMailConfigured()).toBe(false);
	});

	it('is false when a host is set but SMTP_FROM is missing', async () => {
		// Without a From address the message is rejected by most servers, so a
		// half-configured instance must report itself unconfigured rather than
		// fail at send time on every single reset.
		const { isMailConfigured } = await loadMail({
			SMTP_HOST: 'smtp.example.com',
			SMTP_FROM: undefined
		});
		expect(isMailConfigured()).toBe(false);
	});

	it('is true with a host and a from address', async () => {
		const { isMailConfigured } = await loadMail({
			SMTP_HOST: 'smtp.example.com',
			SMTP_FROM: 'filmnacht@example.com'
		});
		expect(isMailConfigured()).toBe(true);
	});
});

describe('sendMail', () => {
	it('returns false rather than throwing when mail is not configured', async () => {
		const { sendMail } = await loadMail({ SMTP_HOST: undefined });
		await expect(sendMail('ada@example.com', 'subject', 'body')).resolves.toBe(false);
	});

	it('returns false and leaks no SMTP secret when the server rejects', async () => {
		// Review Focus 4. Mail libraries put the host, the user and sometimes the
		// password into the error and its .response. None of it may reach a log
		// line, a response body, or a thrown error SvelteKit would render.
		const errors: unknown[] = [];
		vi.spyOn(console, 'error').mockImplementation((...args) => errors.push(...args));

		const { sendMail } = await loadMail({
			SMTP_HOST: 'smtp.example.com',
			SMTP_PORT: '1',
			SMTP_USER: 'postmaster@example.com',
			SMTP_PASS: 'hunter2-should-never-appear',
			SMTP_FROM: 'filmnacht@example.com'
		});

		await expect(sendMail('ada@example.com', 'subject', 'body')).resolves.toBe(false);

		const logged = errors.map((e) => (typeof e === 'string' ? e : JSON.stringify(e))).join(' ');
		expect(logged).not.toContain('hunter2-should-never-appear');
		expect(logged).not.toContain('postmaster@example.com');
		expect(logged).toContain('SMTP');
	});
});
```

- [ ] **Step 3: Run it and watch it fail**

Run: `npx vitest run src/lib/server/mail.test.ts`
Expected: FAIL — `./mail` does not exist.

- [ ] **Step 4: Write the module**

`src/lib/server/mail.ts`:

```ts
import { env } from '$env/dynamic/private';
import nodemailer from 'nodemailer';

/**
 * Half-configured counts as unconfigured. A host with no From address is
 * rejected by most servers, and discovering that once per reset attempt is
 * worse than saying plainly on the form that this instance cannot send mail.
 */
export function isMailConfigured(): boolean {
	return Boolean(env.SMTP_HOST && env.SMTP_FROM);
}

/**
 * Resolves true on a successful send and false on ANY failure. It never throws.
 *
 * The caller is an enumeration-safe route that must answer identically whether
 * the address existed, whether this instance can send mail at all, and whether
 * the server was reachable. A caller given the ability to tell those apart will
 * eventually leak one of them, so the distinction is destroyed here rather than
 * passed up and carefully ignored at every call site.
 */
export async function sendMail(to: string, subject: string, body: string): Promise<boolean> {
	if (!isMailConfigured()) return false;

	try {
		const port = Number(env.SMTP_PORT ?? 587);
		const transport = nodemailer.createTransport({
			host: env.SMTP_HOST,
			port: Number.isInteger(port) && port > 0 ? port : 587,
			// Implicit TLS on 465, STARTTLS everywhere else — the convention every
			// provider's documentation assumes, so an operator who copies their
			// host and port from it gets a working instance without a third knob.
			secure: port === 465,
			auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASS } : undefined
		});
		await transport.sendMail({ from: env.SMTP_FROM, to, subject, text: body });
		return true;
	} catch {
		// Bare catch, deliberately: the error object carries the host, the user
		// and sometimes the password, in `.response` among other places. Plan 2
		// hit this exact class with the TMDB key embedded in a request URL. The
		// operator gets the one fact they can act on and nothing they must not
		// paste into a bug report.
		console.error('SMTP send failed. Check SMTP_HOST, SMTP_PORT and credentials.');
		return false;
	}
}
```

- [ ] **Step 5: Run the tests**

Run: `npx vitest run src/lib/server/mail.test.ts`
Expected: PASS.

- [ ] **Step 6: Document the variables**

Create `.env.example` (or extend it) with every variable and no real values:

```bash
# Optional. With none of these set, the instance works exactly as before and
# the password-reset form says plainly that it cannot send mail. Login never
# depends on any of this.
SMTP_HOST=
SMTP_PORT=587
SMTP_USER=
SMTP_PASS=
SMTP_FROM=
```

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat(mail): optional SMTP transport that never leaks its credentials"
```

---

## Task 2: Reset tokens

**Files:**
- Modify: `src/lib/server/db/schema.ts`; regenerate the migration
- Create: `src/lib/server/resets.ts`, `src/lib/server/resets.test.ts`

**Interfaces:**
- Consumes: `generateToken`, `hashToken` (`src/lib/server/auth/tokens.ts`); `DB` (`src/lib/server/db/client.ts`).
- Produces: `RESET_TTL_MS`; `createReset(db, userId, now?): string` returning the **plaintext** token, which is the only moment it exists; `consumeReset(db, token, now?): string | null` returning the user id and marking the row used, atomically.

**There is no `resolveReset` that does not consume.** A two-step "check then use" is the check-yield-act shape this project has fixed three times. One function, one transaction.

- [ ] **Step 1: Add the table**

In `src/lib/server/db/schema.ts`:

```ts
/**
 * Short-lived, single-use password-reset tokens (PRD §9). Only the SHA-256 hash
 * is stored, exactly as for sessions and login links: a leaked database must not
 * yield a working credential. `usedAt` rather than a delete, so a second click on
 * a link that is sitting in a mailbox forever is refused rather than silently
 * behaving like a fresh one.
 */
export const passwordResets = sqliteTable('password_resets', {
	id: uuid(),
	tokenHash: text('token_hash').notNull().unique(),
	userId: text('user_id')
		.notNull()
		.references(() => users.id, { onDelete: 'cascade' }),
	expiresAt: integer('expires_at', { mode: 'timestamp_ms' }).notNull(),
	usedAt: integer('used_at', { mode: 'timestamp_ms' }),
	createdAt: createdAt()
});
```

Then regenerate: `npx drizzle-kit generate`. The user has confirmed no backwards compatibility is required, so a regenerated `0000` is acceptable; if the tool produces an incremental migration instead, keep it.

- [ ] **Step 2: Write the failing test**

`src/lib/server/resets.test.ts`:

```ts
import { beforeEach, describe, expect, it } from 'vitest';
import { applyMigrations, createDb, type DB } from '$lib/server/db/client';
import { createUser } from '$lib/server/users';
import { consumeReset, createReset, RESET_TTL_MS } from './resets';

let db: DB;
let userId: string;

beforeEach(() => {
	db = createDb(':memory:').db;
	applyMigrations(db);
	userId = createUser(db, {
		username: 'ada',
		displayName: 'Ada',
		passwordHash: 'scrypt$placeholder$placeholder'
	}).id;
});

describe('reset tokens', () => {
	it('resolves a fresh token to its account', () => {
		const token = createReset(db, userId);
		expect(consumeReset(db, token)).toBe(userId);
	});

	it('refuses a token that has already been used', () => {
		// Review Focus 2. A reset link sits in a mailbox indefinitely; single use
		// is the only thing that bounds how long it is dangerous.
		const token = createReset(db, userId);
		expect(consumeReset(db, token)).toBe(userId);
		expect(consumeReset(db, token)).toBeNull();
	});

	it('refuses a token that never existed', () => {
		expect(consumeReset(db, 'not-a-real-token')).toBeNull();
	});

	it('accepts a token one millisecond before it expires and refuses it one after', () => {
		// Review Focus 5. Off by one here is either a token that never works or
		// one that outlives its window.
		const minted = Date.now();
		const a = createReset(db, userId, minted);
		expect(consumeReset(db, a, minted + RESET_TTL_MS - 1)).toBe(userId);

		const b = createReset(db, userId, minted);
		expect(consumeReset(db, b, minted + RESET_TTL_MS + 1)).toBeNull();
	});

	it('stores no plaintext token', () => {
		const token = createReset(db, userId);
		const rows = db.select().from(passwordResets).all();
		expect(rows).toHaveLength(1);
		expect(JSON.stringify(rows)).not.toContain(token);
	});
});
```

Import `passwordResets` from `$lib/server/db/schema` at the top of the file.

- [ ] **Step 3: Run it and watch it fail**

Run: `npx vitest run src/lib/server/resets.test.ts`
Expected: FAIL — `./resets` does not exist.

- [ ] **Step 4: Write the module**

`src/lib/server/resets.ts`:

```ts
import { and, eq, gt, isNull } from 'drizzle-orm';
import { generateToken, hashToken } from './auth/tokens';
import type { DB } from './db/client';
import { passwordResets } from './db/schema';

/**
 * One hour. Long enough to survive a slow mail server and someone reading their
 * inbox after dinner, short enough that a link forwarded or left on a shared
 * screen stops being a credential the same evening.
 */
export const RESET_TTL_MS = 60 * 60 * 1000;

/** Returns the plaintext token. This is the only moment it exists. */
export function createReset(db: DB, userId: string, now = Date.now()): string {
	const token = generateToken();
	db.insert(passwordResets)
		.values({
			id: crypto.randomUUID(),
			tokenHash: hashToken(token),
			userId,
			expiresAt: new Date(now + RESET_TTL_MS)
		})
		.run();
	return token;
}

/**
 * Resolves the token and marks it used in one transaction, returning the user
 * id or null. There is deliberately no "check without consuming" variant: a
 * caller that looks first and acts second is the check-yield-act shape this
 * codebase has had to fix three times, and here it would let two tabs spend one
 * token twice.
 */
export function consumeReset(db: DB, token: string, now = Date.now()): string | null {
	const tokenHash = hashToken(token);
	return db.transaction(() => {
		const row = db
			.select({ id: passwordResets.id, userId: passwordResets.userId })
			.from(passwordResets)
			.where(
				and(
					eq(passwordResets.tokenHash, tokenHash),
					isNull(passwordResets.usedAt),
					gt(passwordResets.expiresAt, new Date(now))
				)
			)
			.get();
		if (!row) return null;

		db.update(passwordResets)
			.set({ usedAt: new Date(now) })
			.where(eq(passwordResets.id, row.id))
			.run();
		return row.userId;
	});
}
```

- [ ] **Step 5: Run the tests**

Run: `npx vitest run src/lib/server/resets.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(auth): single-use password-reset tokens, stored hashed"
```

---

## Task 3: Requesting a reset

**Files:**
- Create: `src/routes/reset/+page.server.ts`, `src/routes/reset/+page.svelte`, `src/routes/reset/reset.test.ts`
- Modify: `src/lib/i18n/en.json`, `src/lib/i18n/de.json`

**Interfaces:**
- Consumes: `isMailConfigured`, `sendMail` (Task 1); `createReset` (Task 2); `rateLimit` (`src/lib/server/rate-limit.ts`); `userByEmail` — **this does not exist yet and you must add it** to `src/lib/server/users.ts`, mirroring `userByUsername`, returning only `{ id }` and matching on a lowercased address.
- Produces: `/reset`.

**The one thing this route exists to get right.** Every submission gets the same answer. Not "we sent it" versus "no such address" — the same answer, for an unknown address, for a known address with mail working, for a known address with the mail server down, and on an instance with no SMTP at all. The page says *statically* whether this instance can send mail, because that is a property of the instance and not of any address; the submission response never varies.

- [ ] **Step 1: Add the translation keys**

English:

```json
	"reset.title": "Reset your password",
	"reset.email": "Email address",
	"reset.submit": "Send a reset link",
	"reset.sent": "If that address belongs to an account here, a reset link is on its way. It expires in an hour.",
	"reset.no_mail": "This instance cannot send email, so there is no reset link to send. A personal login link you saved earlier still signs you in — otherwise ask whoever runs this instance to generate a recovery link for you.",
	"reset.rate_limited": "Too many attempts. Try again in a few minutes.",
	"reset.error.email": "That does not look like an email address."
```

German:

```json
	"reset.title": "Passwort zurücksetzen",
	"reset.email": "E-Mail-Adresse",
	"reset.submit": "Link zum Zurücksetzen senden",
	"reset.sent": "Falls diese Adresse zu einem Konto hier gehört, ist ein Link unterwegs. Er läuft in einer Stunde ab.",
	"reset.no_mail": "Diese Instanz kann keine E-Mails senden, es gibt also keinen Link zu senden. Ein persönlicher Login-Link, den du dir gespeichert hast, meldet dich weiterhin an — sonst bitte die Person, die diese Instanz betreibt, einen Wiederherstellungslink für dich zu erzeugen.",
	"reset.rate_limited": "Zu viele Versuche. Versuch es in ein paar Minuten erneut.",
	"reset.error.email": "Das sieht nicht nach einer E-Mail-Adresse aus."
```

`reset.sent` is deliberately one message for every outcome. Do not add a "no account with that address" string — the whole point is that they are indistinguishable.

- [ ] **Step 2: Add `userByEmail`**

In `src/lib/server/users.ts`, beside `userByUsername`:

```ts
/**
 * Returns only the id. The caller is an enumeration-safe route, and handing it
 * a whole user row invites a branch that behaves differently for an address
 * that exists. Matches lowercased because setEmail normalises before writing.
 */
export function userByEmail(db: DB, email: string) {
	return db
		.select({ id: users.id })
		.from(users)
		.where(eq(users.email, email.trim().toLowerCase()))
		.get();
}
```

- [ ] **Step 3: Write the failing test**

`src/routes/reset/reset.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { applyMigrations, createDb, type DB } from '$lib/server/db/client';
import { passwordResets } from '$lib/server/db/schema';
import { createUser, setEmail } from '$lib/server/users';
import { resetRateLimits } from '$lib/server/rate-limit';

let db: DB;
const sent: Array<{ to: string; body: string }> = [];

vi.mock('$lib/server/db', () => ({
	get db() {
		return db;
	}
}));
vi.mock('$lib/server/mail', () => ({
	isMailConfigured: () => true,
	sendMail: async (to: string, _subject: string, body: string) => {
		sent.push({ to, body });
		return true;
	}
}));

async function post(fields: Record<string, string>, address = '1.2.3.4') {
	const { actions } = await import('./+page.server');
	return actions.default({
		request: new Request('http://localhost/reset', {
			method: 'POST',
			body: new URLSearchParams(fields)
		}),
		getClientAddress: () => address,
		url: new URL('http://localhost/reset')
	} as never);
}

beforeEach(() => {
	db = createDb(':memory:').db;
	applyMigrations(db);
	resetRateLimits();
	sent.length = 0;
	const ada = createUser(db, {
		username: 'ada',
		displayName: 'Ada',
		passwordHash: 'scrypt$placeholder$placeholder'
	});
	setEmail(db, ada.id, 'ada@example.com');
});

describe('POST /reset', () => {
	it('sends a link to an address that has an account', () => {
		// The happy path, asserted first and deliberately: without it every other
		// test here passes against a route that does nothing at all.
		return post({ email: 'ada@example.com' }).then((result) => {
			expect(result?.data?.success).toBe('reset.sent');
			expect(sent).toHaveLength(1);
			expect(sent[0].to).toBe('ada@example.com');
			expect(db.select().from(passwordResets).all()).toHaveLength(1);
		});
	});

	it('answers an unknown address identically and mints nothing', async () => {
		const unknown = await post({ email: 'grace@example.com' });
		const known = await post({ email: 'ada@example.com' }, '5.6.7.8');
		expect(unknown?.data).toEqual(known?.data);
		expect(unknown?.status).toBe(known?.status);
		expect(sent.map((s) => s.to)).toEqual(['ada@example.com']);
	});

	// NOTE: re-mocking a module that is already mocked at the top of the file
	// needs vi.doMock + vi.resetModules, and the dynamic import inside post()
	// must happen AFTER the reset. If this proves awkward, prefer a mutable
	// flag in the top-level mock over fighting the module registry — the
	// property under test is the identical response, not the mocking style.
	it('answers identically when the mail server rejects the message', async () => {
		// Review Focus 1. If a send failure looked different, reachability would
		// become an oracle for which addresses have accounts.
		vi.doMock('$lib/server/mail', () => ({
			isMailConfigured: () => true,
			sendMail: async () => false
		}));
		vi.resetModules();
		const failed = await post({ email: 'ada@example.com' });
		vi.doUnmock('$lib/server/mail');
		vi.resetModules();
		const ok = await post({ email: 'ada@example.com' }, '5.6.7.8');
		expect(failed?.data).toEqual(ok?.data);
		expect(failed?.status).toBe(ok?.status);
	});

	it('is matched case-insensitively', async () => {
		await post({ email: '  ADA@Example.com  ' });
		expect(sent).toHaveLength(1);
	});

	it('rate-limits by address before it looks anything up', async () => {
		for (let i = 0; i < 5; i++) await post({ email: `nobody-${i}@example.com` });
		const result = await post({ email: 'ada@example.com' });
		expect(result?.data?.error).toBe('reset.rate_limited');
		expect(sent).toHaveLength(0);
	});

	it('does not let one address exhaust another address budget', async () => {
		for (let i = 0; i < 5; i++) await post({ email: `nobody-${i}@example.com` }, '1.1.1.1');
		const result = await post({ email: 'ada@example.com' }, '2.2.2.2');
		expect(result?.data?.success).toBe('reset.sent');
	});
});
```

- [ ] **Step 4: Run it and watch it fail**

Run: `npx vitest run src/routes/reset/reset.test.ts`
Expected: FAIL — `./+page.server` does not exist.

- [ ] **Step 5: Write the route**

`src/routes/reset/+page.server.ts`:

```ts
import { db } from '$lib/server/db';
import { isMailConfigured, sendMail } from '$lib/server/mail';
import { rateLimit } from '$lib/server/rate-limit';
import { createReset } from '$lib/server/resets';
import { userByEmail, validateEmail } from '$lib/server/users';
import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = ({ locals }) => {
	if (locals.user) redirect(303, '/profile');
	// A property of the instance, not of any address, so it is safe to render
	// statically. What must never vary is the reply to a submission.
	return { mailConfigured: isMailConfigured() };
};

export const actions: Actions = {
	default: async ({ request, getClientAddress, url }) => {
		// Primary gate, checked first and always. Every key in rate-limit.ts's map
		// is evictable; what matters is that an attacker cannot expand the address
		// key space, where they can mint email addresses at will.
		if (!rateLimit(`reset-ip:${getClientAddress()}`, 5, 300_000)) {
			return fail(429, { error: 'reset.rate_limited' });
		}

		const form = await request.formData();
		const email = validateEmail(form.get('email'));
		if (!email) return fail(400, { error: 'reset.error.email' });

		// Defence in depth against one address being hammered from many sources.
		// Second, never instead: this key is attacker-chosen.
		if (!rateLimit(`reset-addr:${email}`, 5, 300_000)) {
			return fail(429, { error: 'reset.rate_limited' });
		}

		const account = userByEmail(db, email);
		if (account) {
			const token = createReset(db, account.id);
			// The result is deliberately discarded. sendMail never throws, and a
			// failed send must be indistinguishable from a successful one — if it
			// were not, reachability would tell an attacker which addresses exist.
			await sendMail(
				email,
				'Reset your filmnacht password',
				`Open this link within the hour to choose a new password:\n\n${url.origin}/reset/${token}\n\nIf you did not ask for this, nothing has changed and you can ignore this message.`
			);
		}

		// One answer for every path above: unknown address, known address, mail
		// sent, mail refused, mail not configured.
		return { success: 'reset.sent' };
	}
};
```

`validateEmail` returns `''` for an empty value, which `!email` correctly rejects here — an empty submission is not a reset request.

- [ ] **Step 6: Write the page**

A plain form: one email input (`type="email"`, `autocomplete="email"`, `min-h-11`), a submit button, and the success or error banner with `role="alert"`. When `data.mailConfigured` is false, render `reset.no_mail` **instead of** the form — there is nothing useful to submit. No JavaScript.

- [ ] **Step 7: Link it from the login page**

`src/routes/login/+page.svelte` currently renders `login.forgot` as text. Make it link to `/reset`, and update `login.forgot` in both locales to mention the reset form alongside the saved link. Keep it honest about SMTP: the copy must not promise mail, because this instance may have none.

- [ ] **Step 8: Verify and commit**

Run the full gates. Then by hand, with **no** SMTP variables set, confirm `/reset` renders `reset.no_mail` and no form.

```bash
git add -A
git commit -m "feat(auth): request a password reset without leaking who has an account"
```

---

## Task 4: Completing a reset

**Files:**
- Create: `src/routes/reset/[token]/+page.server.ts`, `src/routes/reset/[token]/+page.svelte`, `src/routes/reset/[token]/reset-token.test.ts`
- Modify: `src/lib/i18n/en.json`, `src/lib/i18n/de.json`

**Interfaces:**
- Consumes: `consumeReset` (Task 2); `hashPassword`, `validatePassword` (`src/lib/server/auth/password.ts`); `setPassword`, `regenerateLoginToken` (`src/lib/server/users.ts`); `deleteOtherSessions` (`src/lib/server/auth/session.ts`).
- Produces: `/reset/<token>`.

**This is a revocation path and must revoke everything.** Plan 3's Major finding was a password change that rotated the password and swept sessions while leaving the personal login link alive, so someone who had revealed a link kept access through a change the victim was told had locked them out. A reset is the same moment with a *stronger* assumption — the member could not even sign in — so it must:

1. set the new password,
2. delete **every** session for that account (pass `null` as the keep-id; the caller is not signed in, so there is nothing to keep),
3. rotate `users.login_token_hash`,
4. consume the reset token.

Miss any one and the account is not actually recovered.

- [ ] **Step 1: Add the translation keys**

English:

```json
	"reset.choose_title": "Choose a new password",
	"reset.choose_submit": "Set password and sign in",
	"reset.invalid": "This reset link is not valid any more. Request a new one.",
	"reset.done": "Password set. Every other device has been signed out, and any personal login link you had saved no longer works."
```

German:

```json
	"reset.choose_title": "Neues Passwort wählen",
	"reset.choose_submit": "Passwort setzen und anmelden",
	"reset.invalid": "Dieser Link ist nicht mehr gültig. Fordere einen neuen an.",
	"reset.done": "Passwort gesetzt. Alle anderen Geräte wurden abgemeldet, und ein gespeicherter persönlicher Login-Link funktioniert nicht mehr."
```

One `reset.invalid` for never-existed, expired and already-used. They must not be distinguishable.

- [ ] **Step 2: Write the failing test**

`src/routes/reset/[token]/reset-token.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { applyMigrations, createDb, type DB } from '$lib/server/db/client';
import { hashPassword, verifyPassword } from '$lib/server/auth/password';
import { createSession, validateSession } from '$lib/server/auth/session';
import { createReset, RESET_TTL_MS } from '$lib/server/resets';
import { createUser, regenerateLoginToken, storedPasswordHash } from '$lib/server/users';
import { users } from '$lib/server/db/schema';
import { hashToken } from '$lib/server/auth/tokens';
import { eq } from 'drizzle-orm';

let db: DB;
let userId: string;
vi.mock('$lib/server/db', () => ({
	get db() {
		return db;
	}
}));

async function post(token: string, fields: Record<string, string>) {
	const { actions } = await import('./+page.server');
	return actions
		.default({
			params: { token },
			request: new Request(`http://localhost/reset/${token}`, {
				method: 'POST',
				body: new URLSearchParams(fields)
			}),
			cookies: { set: vi.fn(), get: vi.fn(), delete: vi.fn() },
			url: new URL(`http://localhost/reset/${token}`)
		} as never)
		.catch((thrown) => thrown);
}

const NEW = 'a brand new password';

beforeEach(async () => {
	db = createDb(':memory:').db;
	applyMigrations(db);
	userId = createUser(db, {
		username: 'ada',
		displayName: 'Ada',
		passwordHash: await hashPassword('the old password')
	}).id;
});

describe('POST /reset/[token]', () => {
	it('sets the new password and signs the caller in', async () => {
		const token = createReset(db, userId);
		const thrown = await post(token, { password: NEW, passwordRepeat: NEW });
		expect(thrown?.status).toBe(303);
		expect(await verifyPassword(NEW, storedPasswordHash(db, userId))).toBe(true);
	});

	it('signs out every existing session', async () => {
		const other = createSession(db, userId);
		const token = createReset(db, userId);
		await post(token, { password: NEW, passwordRepeat: NEW });
		expect(validateSession(db, other.token)).toBeNull();
	});

	it('kills a personal login link that was saved before the reset', async () => {
		// The Plan 3 Major finding, in this route's shape. A member resetting a
		// password they could not even remember is at least as likely to be
		// evicting someone as one who still knows it.
		const saved = regenerateLoginToken(db, userId);
		const token = createReset(db, userId);
		await post(token, { password: NEW, passwordRepeat: NEW });
		const row = db
			.select({ hash: users.loginTokenHash })
			.from(users)
			.where(eq(users.id, userId))
			.get();
		expect(row?.hash).not.toBe(hashToken(saved));
	});

	it('refuses a token that has already been spent', async () => {
		const token = createReset(db, userId);
		await post(token, { password: NEW, passwordRepeat: NEW });
		const again = await post(token, { password: 'another one entirely', passwordRepeat: 'another one entirely' });
		expect(again?.data?.error).toBe('reset.invalid');
		expect(await verifyPassword(NEW, storedPasswordHash(db, userId))).toBe(true);
	});

	it('gives an expired token and an invented one the identical answer', async () => {
		const expired = createReset(db, userId, Date.now() - RESET_TTL_MS - 1000);
		const a = await post(expired, { password: NEW, passwordRepeat: NEW });
		const b = await post('never-existed', { password: NEW, passwordRepeat: NEW });
		expect(a?.data).toEqual(b?.data);
		expect(a?.status).toBe(b?.status);
	});

	it('still works when the email address changed after the token was minted', async () => {
		// Review Focus 3. The token resolves to the ACCOUNT. Whoever last touched
		// the email column must not be able to block the owner's recovery.
		const token = createReset(db, userId);
		const { setEmail } = await import('$lib/server/users');
		setEmail(db, userId, 'somewhere-else@example.com');
		const thrown = await post(token, { password: NEW, passwordRepeat: NEW });
		expect(thrown?.status).toBe(303);
	});

	it('rejects a mismatched repeat without spending the token', async () => {
		const token = createReset(db, userId);
		const bad = await post(token, { password: NEW, passwordRepeat: 'not the same' });
		expect(bad?.data?.error).toBe('auth.error.password_mismatch');
		const good = await post(token, { password: NEW, passwordRepeat: NEW });
		expect(good?.status).toBe(303);
	});
});
```

`storedPasswordHash` already exists in `src/lib/server/users.ts` (it is used by the profile). Confirm its signature before relying on it; if it is not exported, export it.

- [ ] **Step 3: Run it and watch it fail**

Run: `npx vitest run "src/routes/reset/[token]/reset-token.test.ts"`
Expected: FAIL — `./+page.server` does not exist.

- [ ] **Step 4: Write the route**

`src/routes/reset/[token]/+page.server.ts`:

```ts
import { hashPassword, validatePassword } from '$lib/server/auth/password';
import { createSession, deleteOtherSessions, setSessionCookie } from '$lib/server/auth/session';
import { db } from '$lib/server/db';
import { consumeReset } from '$lib/server/resets';
import { regenerateLoginToken, setPassword } from '$lib/server/users';
import { fail, redirect } from '@sveltejs/kit';
import type { Actions } from './$types';

export const actions: Actions = {
	default: async ({ params, request, cookies, url }) => {
		const form = await request.formData();
		const password = validatePassword(form.get('password'));
		if (!password) return fail(400, { error: 'auth.error.password' });
		if (password !== form.get('passwordRepeat')) {
			return fail(400, { error: 'auth.error.password_mismatch' });
		}

		// Hashed before the token is spent, so a mistyped repeat does not burn the
		// one link the member has. Everything after this await is synchronous.
		const passwordHash = await hashPassword(password);

		const userId = consumeReset(db, params.token);
		if (!userId) return fail(400, { error: 'reset.invalid' });

		// A revocation path revokes EVERY credential. Plan 3 shipped a password
		// change that swept sessions and left the personal login link alive, so
		// an attacker who had revealed one kept access through a change the
		// victim was told had locked them out. Here the member could not even
		// sign in, which makes "someone else has access" more likely, not less.
		setPassword(db, userId, passwordHash);
		// null, not a token: the third argument is a HASHED session id to spare,
		// and the caller here is not signed in, so every session goes. Check
		// `createSession` if unsure — it stores `id: hashToken(token)`, so
		// passing a raw token here would silently spare nothing and look fine.
		deleteOtherSessions(db, userId, null);
		regenerateLoginToken(db, userId);

		const { token, expiresAt } = createSession(db, userId);
		setSessionCookie(cookies, token, expiresAt, url.protocol === 'https:');
		redirect(303, '/groups');
	}
};
```

- [ ] **Step 5: Write the page**

Two password inputs (`autocomplete="new-password"`, `minlength="8"`, `maxlength="200"`, `min-h-11`), a submit button, `role="alert"` on the error. The page needs no `load`: an invalid token is only discovered on submit, and that is deliberate — a `load` that rejected bad tokens early would turn "does this token exist" into a GET oracle.

- [ ] **Step 6: Verify and commit**

Full gates, then by hand on a production build: request a reset, follow the link, confirm a second browser is signed out and a previously saved login link no longer works.

```bash
git add -A
git commit -m "feat(auth): complete a password reset and revoke every credential"
```

---

## Task 5: Admin recovery, with no mail server

**Files:**
- Create: `src/routes/admin/+page.server.ts`, `src/routes/admin/+page.svelte`, `src/routes/admin/admin.test.ts`
- Modify: `src/lib/i18n/en.json`, `src/lib/i18n/de.json`, `prd.md`

**Interfaces:**
- Consumes: `createReset` (Task 2); `requireUser` (`src/lib/server/groups.ts`); `reauthenticate` (`src/routes/profile/+page.server.ts` — **move it to `src/lib/server/auth/reauth.ts` and import it in both places**; do not copy it, and keep its shared rate-limit bucket intact, since the comment there explains that splitting the bucket doubles an attacker's budget against the same secret).
- Produces: `/admin`.

**This task is what makes the Global Constraint true.** PRD §12 says login never depends on SMTP, and §9 currently records a gap against that rule: a member who forgot their password, saved no link, and has no email has no way back except the operator editing the database by hand. This closes it. **If this task is dropped, the plan has not met its spec** — the emailed reset alone leaves SMTP standing between a member and their account, which is exactly what the rule forbids.

**Why it requires the admin's own password.** Minting a recovery link for another account is at least as powerful as revealing your own, and decision 21 gated that. An admin's unlocked laptop must not be a master key.

- [ ] **Step 1: Extract `reauthenticate`**

Move the helper from `src/routes/profile/+page.server.ts` to `src/lib/server/auth/reauth.ts` unchanged, keeping its comments — especially the one explaining the shared rate-limit bucket. Import it in the profile route. Run the suite: it must stay green, proving the move changed no behaviour.

- [ ] **Step 2: Add the translation keys**

English:

```json
	"admin.title": "Instance administration",
	"admin.members": "Accounts on this instance",
	"admin.recover": "Generate a recovery link",
	"admin.recover_hint": "For a member who forgot their password and cannot receive email. Hand the link over in person or through a channel you trust — it sets a new password and signs out every device they were using.",
	"admin.recover_password": "Your password",
	"admin.recovered": "Recovery link for {name}. It works once and expires in an hour. This is the only time it is shown.",
	"admin.error.forbidden": "Only the instance admin can do this.",
	"nav.admin": "Administration"
```

German:

```json
	"admin.title": "Instanz-Verwaltung",
	"admin.members": "Konten auf dieser Instanz",
	"admin.recover": "Wiederherstellungslink erzeugen",
	"admin.recover_hint": "Für ein Mitglied, das sein Passwort vergessen hat und keine E-Mail empfangen kann. Gib den Link persönlich oder über einen vertrauenswürdigen Kanal weiter — er setzt ein neues Passwort und meldet alle Geräte ab.",
	"admin.recover_password": "Dein Passwort",
	"admin.recovered": "Wiederherstellungslink für {name}. Er funktioniert einmal und läuft in einer Stunde ab. Er wird nur dieses eine Mal angezeigt.",
	"admin.error.forbidden": "Nur die Instanz-Verwaltung kann das tun.",
	"nav.admin": "Verwaltung"
```

- [ ] **Step 3: Write the failing test**

`src/routes/admin/admin.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { applyMigrations, createDb, type DB } from '$lib/server/db/client';
import { hashPassword } from '$lib/server/auth/password';
import { createUser } from '$lib/server/users';
import { passwordResets } from '$lib/server/db/schema';
import { resetRateLimits } from '$lib/server/rate-limit';

let db: DB;
let admin: { id: string };
let member: { id: string };
vi.mock('$lib/server/db', () => ({
	get db() {
		return db;
	}
}));

const ADMIN_PASSWORD = 'the admin password';

async function post(locals: unknown, fields: Record<string, string>) {
	const { actions } = await import('./+page.server');
	return actions
		.recover({
			locals,
			request: new Request('http://localhost/admin', {
				method: 'POST',
				body: new URLSearchParams(fields)
			}),
			url: new URL('http://localhost/admin')
		} as never)
		.catch((thrown) => thrown);
}

beforeEach(async () => {
	db = createDb(':memory:').db;
	applyMigrations(db);
	resetRateLimits();
	admin = createUser(db, {
		username: 'admin',
		displayName: 'Admin',
		passwordHash: await hashPassword(ADMIN_PASSWORD),
		isAdmin: true
	});
	member = createUser(db, {
		username: 'ada',
		displayName: 'Ada',
		passwordHash: await hashPassword('adas password')
	});
});

describe('POST /admin?/recover', () => {
	it('mints a one-time recovery link for a member', async () => {
		const result = await post(
			{ user: { id: admin.id, displayName: 'Admin', isAdmin: true } },
			{ userId: member.id, currentPassword: ADMIN_PASSWORD }
		);
		expect(result?.data?.recoveryUrl).toMatch(/\/reset\/[A-Za-z0-9_-]+$/);
		const rows = db.select().from(passwordResets).all();
		expect(rows).toHaveLength(1);
		expect(rows[0].userId).toBe(member.id);
	});

	it('refuses a non-admin and mints nothing', async () => {
		const result = await post(
			{ user: { id: member.id, displayName: 'Ada', isAdmin: false } },
			{ userId: admin.id, currentPassword: 'adas password' }
		);
		expect(result?.status).toBe(403);
		expect(db.select().from(passwordResets).all()).toHaveLength(0);
	});

	it('refuses an admin who cannot produce their own password', async () => {
		// An admin's unlocked laptop must not be a master key. Decision 21 gated
		// revealing your OWN link; minting one for somebody else is stronger.
		const result = await post(
			{ user: { id: admin.id, displayName: 'Admin', isAdmin: true } },
			{ userId: member.id, currentPassword: 'not the admin password' }
		);
		expect(result?.data?.error).toBe('profile.error.current_password');
		expect(db.select().from(passwordResets).all()).toHaveLength(0);
	});

	it('refuses a user id that does not exist', async () => {
		const result = await post(
			{ user: { id: admin.id, displayName: 'Admin', isAdmin: true } },
			{ userId: 'no-such-user', currentPassword: ADMIN_PASSWORD }
		);
		expect(result?.status).toBe(400);
		expect(db.select().from(passwordResets).all()).toHaveLength(0);
	});
});
```

- [ ] **Step 4: Run it and watch it fail**

Run: `npx vitest run src/routes/admin/admin.test.ts`
Expected: FAIL — `./+page.server` does not exist.

- [ ] **Step 5: Write the route**

`src/routes/admin/+page.server.ts`:

```ts
import { reauthenticate } from '$lib/server/auth/reauth';
import { db } from '$lib/server/db';
import { users } from '$lib/server/db/schema';
import { requireUser } from '$lib/server/groups';
import { createReset } from '$lib/server/resets';
import { error, fail } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import type { Actions, PageServerLoad } from './$types';

/** Admin-only, checked before anything reads or reveals instance state. */
function requireAdmin(locals: App.Locals) {
	const user = requireUser(locals);
	if (!user.isAdmin) error(403, 'Only the instance admin can do this');
	return user;
}

export const load: PageServerLoad = ({ locals }) => {
	requireAdmin(locals);
	return {
		members: db
			.select({ id: users.id, username: users.username, displayName: users.displayName })
			.from(users)
			.orderBy(users.username)
			.all()
	};
};

export const actions: Actions = {
	/**
	 * The SMTP-free half of recovery, and the reason PRD §12's rule holds: a
	 * member who forgot their password, saved no login link and has no email
	 * address still has a way back that involves no mail server at all.
	 *
	 * Requires the admin's own password. Minting a credential for another
	 * account is at least as powerful as revealing your own, which decision 21
	 * gated — an admin's unlocked laptop must not be a master key.
	 */
	recover: async ({ locals, request, url }) => {
		const admin = requireAdmin(locals);
		const form = await request.formData();

		const failure = await reauthenticate(admin.id, form);
		if (failure) return failure;

		const targetId = String(form.get('userId') ?? '');
		const target = db
			.select({ id: users.id, displayName: users.displayName })
			.from(users)
			.where(eq(users.id, targetId))
			.get();
		if (!target) return fail(400, { error: 'admin.error.forbidden' });

		const token = createReset(db, target.id);
		// Shown once and never stored in plaintext. The admin hands it over out of
		// band; using it sets a new password and signs out every device, so the
		// member finds out that this happened.
		return { recoveryUrl: `${url.origin}/reset/${token}`, recoveredName: target.displayName };
	}
};
```

`reauthenticate` must return an `ActionFailure` or `null`. Check its current shape when you extract it in Step 1 and adapt this call site rather than changing the helper.

- [ ] **Step 6: Write the page**

A table of accounts — username and display name — each row with a "Generate a recovery link" button, one shared password input for the admin, and the hint text. When an action returns `recoveryUrl`, render it in a selectable `<code>` block with `admin.recovered`. `min-h-11` on every control, `role="alert"` on errors. No JavaScript.

- [ ] **Step 7: Link it and close the PRD gap**

Add an `/admin` link to the nav, visible only when `data.user?.isAdmin`.

Then update `prd.md`: §9's "Known gap, recorded rather than solved" paragraph and §12's "Where that rule is currently strained" paragraph both describe a hole this task fills. Rewrite them to describe the shipped recovery model — saved link, emailed reset where SMTP exists, admin-generated link everywhere else — and record in the §14 decision table that the gap opened by decision 21 is now closed. **Do not simply delete the paragraphs:** the reasoning that the rule was strained and then repaired is worth more than a document that looks as though nothing ever went wrong.

- [ ] **Step 8: Verify and commit**

Full gates. Then by hand on a production build with **no SMTP configured at all**: as admin, generate a recovery link for a member, use it in another browser, confirm the member's password is changed and their other sessions are gone. That walkthrough is the proof that login does not depend on SMTP.

```bash
git add -A
git commit -m "feat(admin): generate a recovery link without a mail server"
```

---

## Task 6: The whole-flow walkthrough

**Files:**
- Modify: whatever the walkthrough shows to be wrong. If nothing is, this task changes no code and says so.

This task exists because two walkthroughs on Plan 3 passed while a real regression was live — each only walked the path someone had thought to walk — and because `vite dev` has twice concealed a security property from this project.

- [ ] **Step 1: Build and run the real thing**

```bash
npm run build
DATABASE_PATH=/tmp/fn-walk/filmnacht.db ORIGIN=http://localhost:5604 node build/index.js
```

Use a throwaway database. Never touch `data/`. Port 5599 belongs to the user's own process — leave it alone.

- [ ] **Step 2: Walk it with no SMTP configured**

Setup → invite → join as a second member → that member forgets their password → `/reset` says plainly it cannot send mail → admin generates a recovery link → member uses it → member signs in with the new password. Confirm at each step.

- [ ] **Step 3: Walk it with SMTP configured**

Point `SMTP_HOST` at a local catcher (`npx maildev`, or any SMTP sink on localhost) and repeat: `/reset` accepts the address, the mail arrives, the link works once, the second click is refused.

- [ ] **Step 4: Deviate deliberately**

Things the plan did not tell you to try, at least: submitting `/reset` for an address that exists but on an instance where mail is broken; clicking a reset link twice from two browsers at once; requesting a reset, changing the email, then using the link; using a reset link while already signed in as somebody else; a cross-origin POST to every new action (it must 403 — and this claim is only meaningful on this production build).

- [ ] **Step 5: Report, then fix or state that nothing needed fixing**

Write what you observed, not what should have happened. Then commit any fixes.

```bash
git add -A
git commit -m "fix(auth): <what the walkthrough found>"
```
