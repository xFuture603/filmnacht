# Movie nights and the fairness-weighted draw — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the app do the thing it exists for — schedule a movie night, draw one film from the pool by a weighting that nobody can reasonably call unfair, and prove the fairness by simulation rather than by argument.

**Architecture:** The weighting is a pure function over a candidate list, separated from every route and from the database, so it can be simulated a thousand times in a test without touching SQLite. The draw itself is one transaction that picks, records and closes the pool together. Every draw appends to an append-only log carrying the candidates, their weights and the seed, because that data cannot be backfilled later.

**Tech Stack:** SvelteKit 2 / Svelte 5 runes, better-sqlite3 + Drizzle, Vitest, `crypto.randomInt` from `node:crypto`.

**Spec:** `prd.md` — §4 (the pool, account deletion), §6 (nights and the draw, in full), §12 (privacy), §14 decisions.

---

## Global Constraints

Every task's requirements implicitly include this section.

- **The fairness window counts films *watched*, never films *drawn*** (PRD §6, verbatim): *"a cancelled night or a re-draw must not cost anyone their turn."* This is the single easiest thing in this plan to get wrong, and it is wrong in a way no user will report as a bug — they will just feel the app is unfair.
- **A person's weight is `1 / (1 + films of theirs watched in the last 10 movie nights)`.** Nobody ever reaches zero. A newcomer starts at the maximum weight, identical to a member the draw has skipped for the whole window — *as far as the app can tell both have been waiting, and both should go next.*
- **The draw is two-stage: a person first, then one of their films uniformly.** A member who entered ten films must not thereby get ten times the chance of a member who entered one.
- **Randomness comes from `crypto.randomInt`, never `Math.random`** (PRD §6, explicit).
- **Every draw appends to the log and never overwrites it.** A re-draw leaves both results visible. *"Visibility matters more here than prevention."*
- **`suggestions.suggested_by IS NULL` means wildcard and nothing else** — a film that belongs to nobody and counts toward no member's fairness window. A departed member's films are attributed to a **"former member"** placeholder (PRD §4 and §12 both say so), never folded into the wildcard meaning.
- **All times are stored in UTC** and displayed in the instance timezone from `getTimezone(db)` (PRD §6, §12).
- **Cookie `secure` is `url.protocol === 'https:'`, never `!dev`.**
- **Any claim about cookies, CSRF, origin handling or transport must come from `node build/index.js`**, never `vite dev`. The dev server has concealed three security properties from this project already.
- **Authorization runs before anything that reveals or changes state.** A non-member must learn nothing about a group's nights.
- **Test discipline.** Baseline is **357 tests in 30 files** — run the suite, never predict the count. Every test asserting a security or fairness property must be *seen to fail*: break the behaviour it names, confirm red, restore, confirm green. Assert the happy path too — a file that specifies only refusals passes when the feature is absent, which has already happened twice in this project.

## Review Focus

Five things the spec implies that no task's happy-path tests would exercise, most likely to bite first. Each gets a test in the task that owns the code.

1. **Two owners press Draw at the same moment.** The pool must close once and one film must win. Read → `await` → write on a stale read is this project's most repeated defect, fixed four times; the draw is the highest-stakes place left for it. → Task 4.
2. **A member leaves the group between suggesting and the draw.** Their film is still `open` in the pool. Should a departed member's suggestion win the night, and should it count toward a fairness window they are no longer in? The spec is silent; pick a behaviour, state it, and test it. → Task 3.
3. **Fewer than ten nights have ever happened.** The window is "the last 10 movie nights", and a group in its first month has three. Every weight must still be defined and the draw must not divide by anything that can be zero. → Task 3.
4. **A re-draw when exactly one film is open.** The spec permits one re-draw and says exactly one open suggestion "wins, and the app says so plainly rather than pretending to roll dice". Re-drawing that night can only return the same film. Refuse it with a reason rather than appearing to reroll and producing the same answer. → Task 5.
5. **A night scheduled in the past, and one whose `nightEndsAfterMinutes` has elapsed.** Nothing in the MVP moves a night to `watched` on a timer, so a group that forgets to mark one leaves its films out of every future fairness window. Make the transition explicit and reachable, and say in the UI that it is manual. → Task 5.

---

## File Structure

| File | Responsibility |
| --- | --- |
| `src/lib/server/members.ts` | The "former member" placeholder: find or create it, reassign a departing member's rows to it. No HTTP. |
| `src/lib/server/draw.ts` | **Pure.** Candidate weighting and selection over plain objects. No database, no clock, no `Math.random`. |
| `src/lib/server/draw.test.ts` | Unit tests plus the 1000-night fairness simulation. |
| `src/lib/server/nights.ts` | Night lifecycle against the database: schedule, RSVP, draw, cancel, re-draw, mark watched. |
| `src/lib/server/nights.test.ts` | Lifecycle, authorization, the fairness window, and the concurrency guard. |
| `src/routes/groups/[groupId]/nights/+page.server.ts` / `+page.svelte` | List and schedule nights. |
| `src/routes/groups/[groupId]/nights/[nightId]/+page.server.ts` / `+page.svelte` / `night.test.ts` | One night: RSVP, draw, re-draw, cancel, mark watched. |
| `src/lib/server/db/schema.ts` | `suggestions.suggested_by` FK changes; migration regenerated. |
| `src/lib/i18n/en.json`, `de.json` | Copy for all of the above. |

---

## Task 1: The "former member" placeholder

**Files:**
- Create: `src/lib/server/members.ts`, `src/lib/server/members.test.ts`
- Modify: `src/lib/server/db/schema.ts`; regenerate the migration

**Interfaces:**
- Produces: `FORMER_MEMBER_USERNAME` (`'former-member'`); `formerMemberId(db): string` — finds or creates the placeholder account and returns its id; `reassignToFormerMember(db, userId): number` — repoints that member's suggestions and returns how many moved.

**Why this is first, and why it is a bug rather than a feature.** `suggestions.suggested_by` is `onDelete: 'set null'`, and `NULL` already means **wildcard** — a film belonging to nobody, which PRD §6 says *"counts towards no member's fairness window"*. So deleting an account today would silently convert that person's films into wildcards. PRD §4 and §12 both require something different and specific: *"their ratings and suggestions are reassigned to a placeholder 'former member'."* Two different states are currently one value, and the fairness maths in Task 3 is built on telling them apart.

There is no deletion UI yet and none is in this plan. That is exactly why the FK must stop being `set null`: whoever builds deletion should hit a loud failure, not a silent corruption.

- [ ] **Step 1: Change the foreign key**

In `src/lib/server/db/schema.ts`, on the `suggestions` table:

```ts
	/**
	 * NULL means WILDCARD and nothing else (PRD §6): a film belonging to nobody,
	 * counting toward no member's fairness window. A departed member's films are
	 * reassigned to the "former member" placeholder (PRD §4, §12), which is a real
	 * row, so the two states stay distinguishable.
	 *
	 * `restrict`, deliberately not `set null`: a delete that reached here would
	 * silently turn somebody's suggestions into wildcards and drop them out of
	 * fairness counting. Whoever builds account deletion must call
	 * reassignToFormerMember first and should hit a loud constraint error if they
	 * forget, rather than shipping quiet data corruption.
	 */
	suggestedBy: text('suggested_by').references(() => users.id, { onDelete: 'restrict' }),
```

Then `npx drizzle-kit generate`. SQLite cannot alter a foreign key in place, so Drizzle will rebuild the table; read the generated SQL and confirm it preserves every row and index before committing.

- [ ] **Step 2: Write the failing test**

`src/lib/server/members.test.ts`:

```ts
import { beforeEach, describe, expect, it } from 'vitest';
import { and, eq, isNull } from 'drizzle-orm';
import { applyMigrations, createDb, type DB } from '$lib/server/db/client';
import { suggestions, users } from '$lib/server/db/schema';
import { createGroup } from '$lib/server/groups';
import { addSuggestion } from '$lib/server/suggestions';
import { DEFAULT_GROUP_SETTINGS } from '$lib/server/db/schema';
import { createUser } from '$lib/server/users';
import { FORMER_MEMBER_USERNAME, formerMemberId, reassignToFormerMember } from './members';

let db: DB;
let ada: string;
let groupId: string;

beforeEach(() => {
	db = createDb(':memory:').db;
	applyMigrations(db);
	ada = createUser(db, {
		username: 'ada',
		displayName: 'Ada',
		passwordHash: 'scrypt$placeholder$placeholder'
	}).id;
	groupId = createGroup(db, { name: 'Filmnacht', ownerId: ada });
});

describe('the former-member placeholder', () => {
	it('is created once and reused', () => {
		const first = formerMemberId(db);
		const second = formerMemberId(db);
		expect(second).toBe(first);
		const rows = db
			.select({ id: users.id })
			.from(users)
			.where(eq(users.username, FORMER_MEMBER_USERNAME))
			.all();
		expect(rows).toHaveLength(1);
	});

	it('cannot be signed in to', async () => {
		// It exists to own orphaned rows, not to be an account. A usable password
		// here would be a permanent back door with a guessable username.
		const { verifyPassword } = await import('$lib/server/auth/password');
		const id = formerMemberId(db);
		const row = db
			.select({ hash: users.passwordHash })
			.from(users)
			.where(eq(users.id, id))
			.get();
		expect(await verifyPassword('', row?.hash ?? null)).toBe(false);
		expect(await verifyPassword('former-member', row?.hash ?? null)).toBe(false);
	});

	it('takes over a departing member’s suggestions without making them wildcards', () => {
		addSuggestion(db, {
			groupId,
			userId: ada,
			movie: { title: 'Dune', year: 2021 },
			settings: DEFAULT_GROUP_SETTINGS
		});

		const moved = reassignToFormerMember(db, ada);
		expect(moved).toBe(1);

		const placeholder = formerMemberId(db);
		const mine = db
			.select({ id: suggestions.id })
			.from(suggestions)
			.where(eq(suggestions.suggestedBy, placeholder))
			.all();
		expect(mine).toHaveLength(1);

		// The distinction this whole task exists for: not a wildcard.
		const wildcards = db
			.select({ id: suggestions.id })
			.from(suggestions)
			.where(isNull(suggestions.suggestedBy))
			.all();
		expect(wildcards).toHaveLength(0);
	});

	it('leaves other members’ suggestions alone', () => {
		const grace = createUser(db, {
			username: 'grace',
			displayName: 'Grace',
			passwordHash: 'scrypt$placeholder$placeholder'
		}).id;
		addSuggestion(db, {
			groupId,
			userId: ada,
			movie: { title: 'Dune', year: 2021 },
			settings: DEFAULT_GROUP_SETTINGS
		});
		addSuggestion(db, {
			groupId,
			userId: grace,
			movie: { title: 'Arrival', year: 2016 },
			settings: DEFAULT_GROUP_SETTINGS
		});

		reassignToFormerMember(db, ada);

		const stillGrace = db
			.select({ id: suggestions.id })
			.from(suggestions)
			.where(eq(suggestions.suggestedBy, grace))
			.all();
		expect(stillGrace).toHaveLength(1);
	});

	it('reassigns nothing for a member with no suggestions', () => {
		expect(reassignToFormerMember(db, ada)).toBe(0);
	});
});
```

- [ ] **Step 3: Run it and watch it fail**

Run: `npx vitest run src/lib/server/members.test.ts`
Expected: FAIL — `./members` does not exist.

- [ ] **Step 4: Write the module**

`src/lib/server/members.ts`:

```ts
import { eq } from 'drizzle-orm';
import { randomBytes } from 'node:crypto';
import { hashToken } from './auth/tokens';
import type { DB } from './db/client';
import { suggestions, users } from './db/schema';

/**
 * Reserved. `validateUsername` allows [a-z0-9._-], so a real person could in
 * principle claim this — Task 1's route-level guard is that nothing in the app
 * creates accounts except join and setup, and both go through
 * `usernameTaken`, which this row occupies from the first call onward.
 */
export const FORMER_MEMBER_USERNAME = 'former-member';

/**
 * Finds or creates the placeholder that owns a departed member's rows.
 *
 * It is a real `users` row rather than a NULL because NULL already means
 * wildcard (PRD §6) — a film belonging to nobody that counts toward no
 * member's fairness window. Folding "this person left" into that meaning would
 * quietly drop their films out of the group's history.
 */
export function formerMemberId(db: DB): string {
	const existing = db
		.select({ id: users.id })
		.from(users)
		.where(eq(users.username, FORMER_MEMBER_USERNAME))
		.get();
	if (existing) return existing.id;

	const id = crypto.randomUUID();
	db.insert(users)
		.values({
			id,
			username: FORMER_MEMBER_USERNAME,
			displayName: 'Former member',
			// Not a hash of anything: `scrypt$…` is the only format verifyPassword
			// accepts, and a random 64-byte value in the wrong shape can never match
			// any input. This row must never be signable-in.
			passwordHash: `unusable$${randomBytes(32).toString('base64url')}`,
			loginTokenHash: hashToken(randomBytes(32).toString('base64url')),
			isAdmin: false
		})
		.run();
	return id;
}

/**
 * Repoints a member's suggestions at the placeholder and returns how many moved.
 * Call this BEFORE deleting an account: the foreign key is `restrict`, so a
 * delete that skips this step fails loudly instead of corrupting attribution.
 */
export function reassignToFormerMember(db: DB, userId: string): number {
	const placeholder = formerMemberId(db);
	return db
		.update(suggestions)
		.set({ suggestedBy: placeholder })
		.where(eq(suggestions.suggestedBy, userId))
		.run().changes;
}
```

- [ ] **Step 5: Run the tests**

Run: `npx vitest run src/lib/server/members.test.ts`
Expected: PASS.

- [ ] **Step 6: Confirm the placeholder cannot be claimed or signed in to**

Run the full suite. Then check by hand that `verifyPassword` rejects against the `unusable$…` hash — Task 1's second test already asserts this, but confirm the format genuinely cannot parse as `scrypt$salt$key` by reading `src/lib/server/auth/password.ts`.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "fix(pool): attribute a departed member's films, never wildcard them"
```

---

## Task 2: Scheduling a night, and RSVPs

**Files:**
- Create: `src/lib/server/nights.ts`, `src/lib/server/nights.test.ts`
- Modify: `src/lib/i18n/en.json`, `src/lib/i18n/de.json`

**Interfaces:**
- Consumes: `requireMember`, `requireOwner`, `listMembers` (`src/lib/server/groups.ts`); `getTimezone` (`src/lib/server/settings.ts`).
- Produces:
  - `scheduleNight(db, input: { groupId: string; userId: string; scheduledAt: Date; location: string | null }): string` — returns the new night id.
  - `listNights(db, groupId): NightSummary[]` where `NightSummary = { id: string; scheduledAt: Date; location: string | null; status: 'scheduled' | 'drawn' | 'watched' | 'cancelled'; yes: number; no: number; maybe: number }`.
  - `nightDetail(db, nightId, viewerId): NightDetail | null` — `NightDetail = NightSummary & { groupId: string; drawnTitle: string | null; drawnBy: string | null; myResponse: 'yes' | 'no' | 'maybe' | null; responses: Array<{ displayName: string; response: 'yes' | 'no' | 'maybe' }> }`.
  - `respond(db, nightId, userId, response: 'yes' | 'no' | 'maybe'): void`.
  - `LOCATION_MAX = 120`.

**Who may schedule.** PRD §6: *"The owner (optionally any member, per setting)"*. There is no such setting in `GroupSettings` and adding one is not in scope — **the owner schedules, and the plan records that the per-member variant is deferred.** Do not invent a setting; a knob nobody asked for is the thing this project keeps deleting.

**RSVP does not affect the draw.** A member who answers "no" still has their suggestions in the running. Nothing in §6 ties attendance to eligibility, and coupling them would let someone improve their odds by declining. Say so in a comment where a reader might expect otherwise.

- [ ] **Step 1: Add the translation keys**

English:

```json
	"nights.title": "Movie nights",
	"nights.schedule": "Schedule a night",
	"nights.when": "Date and time",
	"nights.location": "Location (optional)",
	"nights.none": "No nights scheduled yet.",
	"nights.status.scheduled": "Scheduled",
	"nights.status.drawn": "Film drawn",
	"nights.status.watched": "Watched",
	"nights.status.cancelled": "Cancelled",
	"nights.rsvp.yes": "I'm in",
	"nights.rsvp.no": "Can't make it",
	"nights.rsvp.maybe": "Maybe",
	"nights.error.when": "That is not a date and time this instance can use.",
	"nights.error.past": "That moment has already passed.",
	"nights.error.location": "That location is too long.",
	"nights.error.not_owner": "Only the group's owner can do that."
```

German:

```json
	"nights.title": "Filmnächte",
	"nights.schedule": "Filmnacht planen",
	"nights.when": "Datum und Uhrzeit",
	"nights.location": "Ort (optional)",
	"nights.none": "Noch keine Filmnacht geplant.",
	"nights.status.scheduled": "Geplant",
	"nights.status.drawn": "Film gezogen",
	"nights.status.watched": "Gesehen",
	"nights.status.cancelled": "Abgesagt",
	"nights.rsvp.yes": "Ich bin dabei",
	"nights.rsvp.no": "Kann nicht",
	"nights.rsvp.maybe": "Vielleicht",
	"nights.error.when": "Damit kann diese Instanz kein Datum und keine Uhrzeit bilden.",
	"nights.error.past": "Dieser Zeitpunkt ist schon vorbei.",
	"nights.error.location": "Dieser Ort ist zu lang.",
	"nights.error.not_owner": "Nur die Gruppenleitung kann das tun."
```

- [ ] **Step 2: Write the failing test**

`src/lib/server/nights.test.ts`:

```ts
import { beforeEach, describe, expect, it } from 'vitest';
import { applyMigrations, createDb, type DB } from '$lib/server/db/client';
import { addMember, createGroup } from '$lib/server/groups';
import { createUser } from '$lib/server/users';
import { LOCATION_MAX, listNights, nightDetail, respond, scheduleNight } from './nights';

let db: DB;
let ada: string;
let grace: string;
let groupId: string;
const LATER = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

beforeEach(() => {
	db = createDb(':memory:').db;
	applyMigrations(db);
	ada = createUser(db, {
		username: 'ada',
		displayName: 'Ada',
		passwordHash: 'scrypt$placeholder$placeholder'
	}).id;
	grace = createUser(db, {
		username: 'grace',
		displayName: 'Grace',
		passwordHash: 'scrypt$placeholder$placeholder'
	}).id;
	groupId = createGroup(db, { name: 'Filmnacht', ownerId: ada });
	addMember(db, grace, groupId);
});

describe('scheduleNight', () => {
	it('schedules a night the group can see', () => {
		const id = scheduleNight(db, {
			groupId,
			userId: ada,
			scheduledAt: LATER,
			location: "Ada's flat"
		});
		const nights = listNights(db, groupId);
		expect(nights).toHaveLength(1);
		expect(nights[0].id).toBe(id);
		expect(nights[0].status).toBe('scheduled');
		expect(nights[0].location).toBe("Ada's flat");
	});

	it('refuses a member who does not own the group', () => {
		expect(() =>
			scheduleNight(db, { groupId, userId: grace, scheduledAt: LATER, location: null })
		).toThrow();
	});

	it('refuses somebody who is not in the group at all', () => {
		const mallory = createUser(db, {
			username: 'mallory',
			displayName: 'Mallory',
			passwordHash: 'scrypt$placeholder$placeholder'
		}).id;
		expect(() =>
			scheduleNight(db, { groupId, userId: mallory, scheduledAt: LATER, location: null })
		).toThrow();
	});

	it('stores the moment in UTC', () => {
		const id = scheduleNight(db, { groupId, userId: ada, scheduledAt: LATER, location: null });
		const night = nightDetail(db, id, ada);
		// Round-trips to the same instant. The display timezone is a render-time
		// concern; the column is UTC (PRD §6).
		expect(night?.scheduledAt.getTime()).toBe(Math.floor(LATER.getTime() / 1000) * 1000);
	});
});

describe('respond', () => {
	it('records a response and counts it', () => {
		const id = scheduleNight(db, { groupId, userId: ada, scheduledAt: LATER, location: null });
		respond(db, id, grace, 'yes');
		expect(listNights(db, groupId)[0].yes).toBe(1);
		expect(nightDetail(db, id, grace)?.myResponse).toBe('yes');
	});

	it('replaces an earlier response instead of adding a second', () => {
		const id = scheduleNight(db, { groupId, userId: ada, scheduledAt: LATER, location: null });
		respond(db, id, grace, 'yes');
		respond(db, id, grace, 'no');
		const nights = listNights(db, groupId);
		expect(nights[0].yes).toBe(0);
		expect(nights[0].no).toBe(1);
		expect(nightDetail(db, id, grace)?.responses).toHaveLength(1);
	});

	it('refuses a response from outside the group', () => {
		const mallory = createUser(db, {
			username: 'mallory',
			displayName: 'Mallory',
			passwordHash: 'scrypt$placeholder$placeholder'
		}).id;
		const id = scheduleNight(db, { groupId, userId: ada, scheduledAt: LATER, location: null });
		expect(() => respond(db, id, mallory, 'yes')).toThrow();
	});
});

describe('nightDetail', () => {
	it('returns nothing for a viewer outside the group', () => {
		const mallory = createUser(db, {
			username: 'mallory',
			displayName: 'Mallory',
			passwordHash: 'scrypt$placeholder$placeholder'
		}).id;
		const id = scheduleNight(db, { groupId, userId: ada, scheduledAt: LATER, location: null });
		expect(nightDetail(db, id, mallory)).toBeNull();
	});

	it('returns nothing for a night that does not exist', () => {
		expect(nightDetail(db, 'no-such-night', ada)).toBeNull();
	});
});

describe('input bounds', () => {
	it('refuses a location past the limit', () => {
		expect(() =>
			scheduleNight(db, {
				groupId,
				userId: ada,
				scheduledAt: LATER,
				location: 'x'.repeat(LOCATION_MAX + 1)
			})
		).toThrow();
	});
});
```

- [ ] **Step 3: Run it and watch it fail**

Run: `npx vitest run src/lib/server/nights.test.ts`
Expected: FAIL — `./nights` does not exist.

- [ ] **Step 4: Write the module**

`src/lib/server/nights.ts`. Import `and`, `eq`, `desc`, `sql` from `drizzle-orm`; `requireMember`, `requireOwner` from `./groups`; `attendance`, `movieNights`, `movies`, `suggestions`, `users` from `./db/schema`.

```ts
export const LOCATION_MAX = 120;

export function scheduleNight(
	db: DB,
	input: { groupId: string; userId: string; scheduledAt: Date; location: string | null }
): string {
	// Authorization before anything else touches or reveals state.
	requireOwner(db, input.userId, input.groupId);

	const location = input.location?.trim() || null;
	if (location && location.length > LOCATION_MAX) {
		throw new Error(`location exceeds ${LOCATION_MAX} characters`);
	}
	if (!Number.isFinite(input.scheduledAt.getTime())) {
		throw new Error('scheduledAt is not a usable date');
	}

	const id = crypto.randomUUID();
	db.insert(movieNights)
		.values({ id, groupId: input.groupId, scheduledAt: input.scheduledAt, location })
		.run();
	return id;
}

export function respond(
	db: DB,
	nightId: string,
	userId: string,
	response: 'yes' | 'no' | 'maybe'
): void {
	const night = db
		.select({ groupId: movieNights.groupId })
		.from(movieNights)
		.where(eq(movieNights.id, nightId))
		.get();
	if (!night) throw new Error('no such night');
	// Membership is the authorization, and it is checked against the night's own
	// group rather than one supplied by the caller.
	requireMember(db, userId, night.groupId);

	// One row per (night, member): the unique index makes this an upsert rather
	// than letting a second click add a second answer.
	db.insert(attendance)
		.values({ id: crypto.randomUUID(), movieNightId: nightId, userId, response })
		.onConflictDoUpdate({
			target: [attendance.movieNightId, attendance.userId],
			set: { response }
		})
		.run();
}
```

`listNights(db, groupId)` selects the nights ordered by `desc(movieNights.scheduledAt)` and, for each, counts its attendance rows grouped by response. A correlated subquery per response keeps it one statement; at a dozen nights per group the shape matters less than its readability.

`nightDetail(db, nightId, viewerId)` returns `null` when the night does not exist **or** the viewer is not a member — the same answer for both, so a non-member cannot distinguish a group they may not see from a night that never existed. Left-join `suggestions` and `movies` through `movieNights.suggestionId` for `drawnTitle`, and `users` for `drawnBy`.

**Note the RSVP/eligibility question explicitly in the module docblock:** answering "no" does not remove a member's suggestions from the draw, because §6 never ties the two and coupling them would let someone improve their odds by declining.

- [ ] **Step 5: Run the tests**

Run: `npx vitest run src/lib/server/nights.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(nights): schedule a movie night and collect RSVPs"
```

---

## Task 3: The weighting, as a pure function

**Files:**
- Create: `src/lib/server/draw.ts`, `src/lib/server/draw.test.ts`

**Interfaces:**
- Consumes: nothing. **No database, no clock, no route.** That is the point: a thousand simulated nights must cost nothing but arithmetic.
- Produces:
  - `type Candidate = { userId: string; suggestionIds: string[]; watchedInWindow: number }`
  - `type DrawLogEntry = { at: string; seed: number; mode: 'fairness' | 'uniform'; candidates: Array<{ userId: string; weight: number; suggestions: number }>; pickedUserId: string; pickedSuggestionId: string; reason?: string }`
  - `FAIRNESS_WINDOW_NIGHTS = 10`
  - `weightFor(watchedInWindow: number): number`
  - `newSeed(): number` — `crypto.randomInt`, never `Math.random`
  - `drawFrom(candidates: Candidate[], mode: 'fairness' | 'uniform', seed: number): { userId: string; suggestionId: string; candidates: DrawLogEntry['candidates'] } | null`

**Reproducible from the log.** §6 requires the log to carry *"the seed used"*, which is only meaningful if the same seed reproduces the same result. So the cryptographic source generates a **seed**, and the seed drives a small deterministic generator. `crypto.randomInt` alone cannot do this: it is not seedable, and logging its outputs would record the answer rather than the means.

**Candidates are current members only.** A suggestion whose author has left the group, or is the former-member placeholder, or is a wildcard (`NULL`), stays in the pool as history but cannot win — the draw draws *people*, and those are not people who can take a turn. Task 4 builds the candidate list and owns that query; this module only promises that a candidate with no `suggestionIds` is never returned.

- [ ] **Step 1: Write the failing test**

`src/lib/server/draw.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { FAIRNESS_WINDOW_NIGHTS, drawFrom, newSeed, weightFor } from './draw';

const candidate = (userId: string, films: number, watched: number) => ({
	userId,
	suggestionIds: Array.from({ length: films }, (_, i) => `${userId}-film-${i}`),
	watchedInWindow: watched
});

describe('weightFor', () => {
	it('gives a member who has had no turn the maximum weight', () => {
		expect(weightFor(0)).toBe(1);
	});

	it('halves after one turn and never reaches zero', () => {
		expect(weightFor(1)).toBe(0.5);
		expect(weightFor(FAIRNESS_WINDOW_NIGHTS)).toBeGreaterThan(0);
	});

	it('treats a newcomer exactly like a member skipped for the whole window', () => {
		// PRD §6: "as far as the app can tell both have been waiting, and both
		// should go next." A newcomer has 0 watched films in the window; so does
		// somebody the draw has passed over ten times running.
		expect(weightFor(0)).toBe(weightFor(0));
	});
});

describe('drawFrom', () => {
	it('returns null when nobody is eligible', () => {
		expect(drawFrom([], 'fairness', 1)).toBeNull();
	});

	it('returns the only candidate’s only film', () => {
		const result = drawFrom([candidate('ada', 1, 0)], 'fairness', 12345);
		expect(result?.userId).toBe('ada');
		expect(result?.suggestionId).toBe('ada-film-0');
	});

	it('is reproducible from the seed', () => {
		// The whole point of logging a seed. Two runs at one seed must agree, or
		// the log records an answer nobody can check.
		const people = [candidate('ada', 3, 0), candidate('grace', 2, 1), candidate('alan', 1, 4)];
		const a = drawFrom(people, 'fairness', 987654);
		const b = drawFrom(people, 'fairness', 987654);
		expect(b).toEqual(a);
	});

	it('gives different seeds different outcomes across a run of draws', () => {
		// Guards against a generator that ignores its seed, which would make every
		// draw in the instance's life return the same film.
		const people = [candidate('ada', 1, 0), candidate('grace', 1, 0), candidate('alan', 1, 0)];
		const picks = new Set(
			Array.from({ length: 50 }, (_, i) => drawFrom(people, 'fairness', i + 1)?.userId)
		);
		expect(picks.size).toBeGreaterThan(1);
	});

	it('reports every candidate’s weight, not only the winner’s', () => {
		// §6: the log carries "the candidate list with weights". A log holding only
		// the winner cannot answer "how did this happen?".
		const result = drawFrom([candidate('ada', 1, 0), candidate('grace', 1, 3)], 'fairness', 42);
		expect(result?.candidates).toHaveLength(2);
		expect(result?.candidates.find((c) => c.userId === 'grace')?.weight).toBe(0.25);
		expect(result?.candidates.find((c) => c.userId === 'ada')?.suggestions).toBe(1);
	});

	it('never returns a candidate who has no films', () => {
		const result = drawFrom([candidate('ada', 0, 0), candidate('grace', 1, 9)], 'fairness', 7);
		expect(result?.userId).toBe('grace');
	});

	it('ignores the weighting in uniform mode', () => {
		// drawMode: 'uniform' exists in GroupSettings; a group that wants a plain
		// coin toss must get one.
		const heavilySkewed = [candidate('ada', 1, 0), candidate('grace', 1, 50)];
		const picks = Array.from(
			{ length: 400 },
			(_, i) => drawFrom(heavilySkewed, 'uniform', i + 1)?.userId
		);
		const graceShare = picks.filter((p) => p === 'grace').length / picks.length;
		// Under fairness weighting Grace's share would be 1/52 ≈ 2%.
		expect(graceShare).toBeGreaterThan(0.35);
		expect(graceShare).toBeLessThan(0.65);
	});

	it('does not give a member with ten films ten times the chance', () => {
		// The reason the draw is two-stage (§6). Both have had no turn, so both
		// should be near even regardless of how many films they entered.
		const people = [candidate('ada', 10, 0), candidate('grace', 1, 0)];
		const picks = Array.from(
			{ length: 600 },
			(_, i) => drawFrom(people, 'fairness', i + 1)?.userId
		);
		const graceShare = picks.filter((p) => p === 'grace').length / picks.length;
		expect(graceShare).toBeGreaterThan(0.35);
		expect(graceShare).toBeLessThan(0.65);
	});
});

describe('newSeed', () => {
	it('produces a non-negative integer that varies', () => {
		const seeds = new Set(Array.from({ length: 200 }, () => newSeed()));
		expect(seeds.size).toBeGreaterThan(190);
		for (const s of seeds) {
			expect(Number.isInteger(s)).toBe(true);
			expect(s).toBeGreaterThanOrEqual(0);
		}
	});
});

describe('fairness, by simulation rather than by argument', () => {
	it('keeps the busiest and quietest of eight members within a fixed ratio over 1000 nights', () => {
		// PRD Goal 1 asks for "demonstrably, not just by feel". This is that proof.
		// Eight members, one film each, every night watched, weights recomputed from
		// a rolling ten-night window exactly as the app does it.
		const members = Array.from({ length: 8 }, (_, i) => `m${i}`);
		const watchedNights: string[] = []; // whose film won, most recent last
		const wins = new Map(members.map((m) => [m, 0]));

		for (let night = 0; night < 1000; night++) {
			const window = watchedNights.slice(-FAIRNESS_WINDOW_NIGHTS);
			const candidates = members.map((m) => ({
				userId: m,
				suggestionIds: [`${m}-film`],
				watchedInWindow: window.filter((w) => w === m).length
			}));
			const result = drawFrom(candidates, 'fairness', newSeed());
			if (!result) throw new Error('the draw returned nobody');
			wins.set(result.userId, (wins.get(result.userId) ?? 0) + 1);
			watchedNights.push(result.userId);
		}

		const counts = [...wins.values()];
		const ratio = Math.max(...counts) / Math.min(...counts);
		// A uniform draw over 1000 nights lands near 1.2; the fairness weighting
		// should be tighter still. 1.35 leaves room for ordinary variance while
		// failing loudly if the weighting stops working.
		expect(ratio).toBeLessThan(1.35);
	});

	it('gives a member returning after a long absence the next turn, not a queue position', () => {
		// The feeling the app exists to remove: "I have not picked in months."
		const members = ['ada', 'grace', 'alan'];
		const window = ['grace', 'grace', 'alan', 'grace', 'alan'];
		const candidates = members.map((m) => ({
			userId: m,
			suggestionIds: [`${m}-film`],
			watchedInWindow: window.filter((w) => w === m).length
		}));
		const picks = Array.from({ length: 300 }, (_, i) => drawFrom(candidates, 'fairness', i + 1)!);
		const adaShare = picks.filter((p) => p.userId === 'ada').length / picks.length;
		// Weights are 1, 1/4, 1/3 — Ada's share of 1 + 0.25 + 0.333 is about 63%.
		expect(adaShare).toBeGreaterThan(0.5);
	});
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run src/lib/server/draw.test.ts`
Expected: FAIL — `./draw` does not exist.

- [ ] **Step 3: Write the module**

`src/lib/server/draw.ts`:

```ts
import { randomInt } from 'node:crypto';

/**
 * PRD §6. Rolling, so founding members are not penalised for years, and so a
 * member the draw has skipped throughout the window carries the same weight as
 * somebody who joined yesterday — as far as the app can tell, both have been
 * waiting.
 */
export const FAIRNESS_WINDOW_NIGHTS = 10;

export type Candidate = {
	userId: string;
	/** Their OPEN suggestions in this group. A candidate with none never wins. */
	suggestionIds: string[];
	/** Films of theirs WATCHED in the window — never merely drawn (PRD §6). */
	watchedInWindow: number;
};

export type DrawLogEntry = {
	at: string;
	seed: number;
	mode: 'fairness' | 'uniform';
	candidates: Array<{ userId: string; weight: number; suggestions: number }>;
	pickedUserId: string;
	pickedSuggestionId: string;
	/** Present on a re-draw: who re-ran it and why (PRD §6). */
	reason?: string;
};

/** `1 / (1 + watched)`. Monotonic, never zero, maximum for somebody untouched. */
export function weightFor(watchedInWindow: number): number {
	return 1 / (1 + Math.max(0, watchedInWindow));
}

/**
 * A seed from a cryptographically secure source (PRD §6 names `crypto.randomInt`
 * and rules out `Math.random`). The seed is what gets logged, so the draw has to
 * be reproducible FROM it — which is why the selection below runs a deterministic
 * generator rather than calling randomInt for each choice. Logging randomInt's
 * outputs would record the answer instead of the means.
 */
export function newSeed(): number {
	return randomInt(0, 2 ** 31 - 1);
}

/** mulberry32: small, fast, and deterministic for a given seed. */
function generator(seed: number): () => number {
	let a = seed >>> 0;
	return () => {
		a = (a + 0x6d2b79f5) >>> 0;
		let t = Math.imul(a ^ (a >>> 15), 1 | a);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

/**
 * Two stages, and the order is the point (PRD §6): a person is drawn first, then
 * one of that person's films uniformly. Drawing across all films instead would
 * give somebody who entered ten of them ten times the chance of somebody who
 * entered one, and the per-member cap would have to carry a load it was not
 * meant for.
 */
export function drawFrom(
	candidates: Candidate[],
	mode: 'fairness' | 'uniform',
	seed: number
): { userId: string; suggestionId: string; candidates: DrawLogEntry['candidates'] } | null {
	const eligible = candidates.filter((c) => c.suggestionIds.length > 0);
	if (eligible.length === 0) return null;

	const weights = eligible.map((c) => (mode === 'uniform' ? 1 : weightFor(c.watchedInWindow)));
	const log = eligible.map((c, i) => ({
		userId: c.userId,
		weight: weights[i],
		suggestions: c.suggestionIds.length
	}));

	const next = generator(seed);
	const total = weights.reduce((sum, w) => sum + w, 0);
	let roll = next() * total;
	// Falls back to the last candidate, which is where floating-point rounding
	// lands when the roll is a hair above the running total.
	let index = eligible.length - 1;
	for (let i = 0; i < eligible.length; i++) {
		roll -= weights[i];
		if (roll < 0) {
			index = i;
			break;
		}
	}

	const who = eligible[index];
	const films = who.suggestionIds;
	const suggestionId = films[Math.floor(next() * films.length)] ?? films[films.length - 1];
	return { userId: who.userId, suggestionId, candidates: log };
}
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run src/lib/server/draw.test.ts`
Expected: PASS, including the 1000-night simulation.

- [ ] **Step 5: Prove the simulation is not decorative**

Temporarily replace `weightFor`'s body with `return 1;` — a uniform draw wearing the fairness label. Run the simulation test.

**If it still passes, the bound is too loose and the test is worthless**: tighten it until a uniform draw fails, then restore the real weighting and confirm green. Report both ratios. A fairness test that passes without the fairness weighting is exactly the hollow-test shape this project has shipped twice.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(draw): fairness weighting as a pure, seed-reproducible function"
```

---

## Task 4: Drawing a film for a night

**Files:**
- Modify: `src/lib/server/nights.ts`, `src/lib/server/nights.test.ts`, `src/lib/i18n/en.json`, `src/lib/i18n/de.json`

**Interfaces:**
- Consumes: `drawFrom`, `newSeed`, `FAIRNESS_WINDOW_NIGHTS`, `DrawLogEntry` (Task 3); `requireOwner` (`./groups`).
- Produces: `drawForNight(db, nightId, ownerId, reason?: string): DrawOutcome` where
  ```ts
  type DrawOutcome =
  	| { ok: true; suggestionId: string; title: string; onlyCandidate: boolean }
  	| { ok: false; reason: 'not_found' | 'not_scheduled' | 'no_candidates' | 'redraw_used' | 'sole_suggestion' };
  ```
  and `candidatesFor(db, groupId): Candidate[]`, exported so Task 6 can render the pool's drawability without triggering a draw.

**The concurrency guard, which is the whole risk in this task.** Two owners pressing Draw at the same moment must produce **one** result. This project has fixed read → `await` → write on a stale read four times — in setup, in the invite redeem, in the suggestion cap, and in the join username check. The draw is the highest-stakes place it can still happen, because the visible symptom is not an error but *a group arguing about which film was really drawn*.

So: the status test and the write live in **one `db.transaction`**, the status check is a test-and-set rather than a read followed by a write, and **nothing inside the transaction awaits**. `drawForNight` is deliberately synchronous — if a later change wants to await inside it, that is the signal to stop and reconsider, not to make the function async.

**Exactly one open suggestion "wins, and the app says so plainly rather than pretending to roll dice"** (§6). Hence `onlyCandidate` on the result: the UI uses it to say so, and the draw still records a log entry so the history is uniform.

- [ ] **Step 1: Add the translation keys**

English:

```json
	"night.draw": "Draw a film",
	"night.redraw": "Draw again",
	"night.redraw_reason": "Why are you drawing again?",
	"night.drawn_one": "Only one film was suggested, so {title} it is — no dice were rolled.",
	"night.drawn": "{title}, suggested by {name}.",
	"night.drawn_former": "{title}, suggested by a member who has since left.",
	"night.error.no_candidates": "Nobody has suggested anything yet.",
	"night.error.not_scheduled": "This night is not waiting for a draw.",
	"night.error.redraw_used": "This night has already been drawn again once.",
	"night.error.sole_suggestion": "There is only one film in the pool, so drawing again would return it. Add another suggestion first."
```

German:

```json
	"night.draw": "Film ziehen",
	"night.redraw": "Neu ziehen",
	"night.redraw_reason": "Warum wird neu gezogen?",
	"night.drawn_one": "Es wurde nur ein Film vorgeschlagen, also wird es {title} — gewürfelt wurde nicht.",
	"night.drawn": "{title}, vorgeschlagen von {name}.",
	"night.drawn_former": "{title}, vorgeschlagen von einem Mitglied, das die Gruppe verlassen hat.",
	"night.error.no_candidates": "Es hat noch niemand etwas vorgeschlagen.",
	"night.error.not_scheduled": "Für diese Filmnacht steht keine Ziehung an.",
	"night.error.redraw_used": "Für diese Filmnacht wurde schon einmal neu gezogen.",
	"night.error.sole_suggestion": "Es liegt nur ein Film im Pool, neu ziehen würde ihn wieder liefern. Schlag zuerst einen weiteren vor."
```

- [ ] **Step 2: Write the failing tests**

Append to `src/lib/server/nights.test.ts`:

```ts
describe('drawForNight', () => {
	function openFilm(userId: string, title: string) {
		return addSuggestion(db, {
			groupId,
			userId,
			movie: { title },
			settings: DEFAULT_GROUP_SETTINGS
		});
	}

	it('draws the only suggestion and says it did not roll dice', () => {
		openFilm(ada, 'Dune');
		const id = scheduleNight(db, { groupId, userId: ada, scheduledAt: LATER, location: null });
		const result = drawForNight(db, id, ada);
		expect(result).toMatchObject({ ok: true, title: 'Dune', onlyCandidate: true });
	});

	it('closes the pool for that night and marks the suggestion drawn', () => {
		openFilm(ada, 'Dune');
		const id = scheduleNight(db, { groupId, userId: ada, scheduledAt: LATER, location: null });
		drawForNight(db, id, ada);
		expect(nightDetail(db, id, ada)?.status).toBe('drawn');
		expect(listPool(db, groupId, ada).find((e) => e.title === 'Dune')?.status).toBe('drawn');
	});

	it('refuses when nobody has suggested anything', () => {
		const id = scheduleNight(db, { groupId, userId: ada, scheduledAt: LATER, location: null });
		expect(drawForNight(db, id, ada)).toEqual({ ok: false, reason: 'no_candidates' });
	});

	it('refuses a member who does not own the group', () => {
		openFilm(ada, 'Dune');
		const id = scheduleNight(db, { groupId, userId: ada, scheduledAt: LATER, location: null });
		expect(() => drawForNight(db, id, grace)).toThrow();
	});

	it('draws once when two owners press the button at the same moment', () => {
		// Review Focus 1. The symptom of getting this wrong is not an error, it is
		// a group arguing about which film was really drawn.
		openFilm(ada, 'Dune');
		openFilm(grace, 'Arrival');
		const id = scheduleNight(db, { groupId, userId: ada, scheduledAt: LATER, location: null });

		const first = drawForNight(db, id, ada);
		const second = drawForNight(db, id, ada);

		expect(first.ok).toBe(true);
		expect(second).toEqual({ ok: false, reason: 'not_scheduled' });
		// And exactly one film left the pool.
		const drawn = listPool(db, groupId, ada).filter((e) => e.status === 'drawn');
		expect(drawn).toHaveLength(1);
	});

	it('records every candidate and the seed in an append-only log', () => {
		openFilm(ada, 'Dune');
		openFilm(grace, 'Arrival');
		const id = scheduleNight(db, { groupId, userId: ada, scheduledAt: LATER, location: null });
		drawForNight(db, id, ada);

		const row = db
			.select({ log: movieNights.drawLog, seed: movieNights.drawSeed })
			.from(movieNights)
			.where(eq(movieNights.id, id))
			.get();
		const log = row?.log as DrawLogEntry[];
		expect(log).toHaveLength(1);
		expect(log[0].candidates).toHaveLength(2);
		expect(log[0].seed).toBeGreaterThanOrEqual(0);
		expect(String(row?.seed)).toBe(String(log[0].seed));
	});

	it('leaves a departed member’s film in the pool but out of the draw', () => {
		// Review Focus 2. The draw draws people; somebody who left is not a person
		// who can take a turn. Their film stays visible as history.
		openFilm(grace, 'Arrival');
		leaveGroup(db, grace, groupId);
		const id = scheduleNight(db, { groupId, userId: ada, scheduledAt: LATER, location: null });

		expect(drawForNight(db, id, ada)).toEqual({ ok: false, reason: 'no_candidates' });
		expect(listPool(db, groupId, ada).map((e) => e.title)).toContain('Arrival');
	});

	it('counts only watched nights in the fairness window', () => {
		// The Global Constraint, and the easiest thing here to get wrong. A night
		// that was drawn but never watched must not cost anybody their turn.
		openFilm(ada, 'Dune');
		const drawnOnly = scheduleNight(db, {
			groupId,
			userId: ada,
			scheduledAt: LATER,
			location: null
		});
		drawForNight(db, drawnOnly, ada);

		// Ada's film is drawn but the night is not watched, so her weight must
		// still be the maximum.
		openFilm(ada, 'Arrival');
		expect(candidatesFor(db, groupId).find((c) => c.userId === ada)?.watchedInWindow).toBe(0);
	});

	it('defines every weight in a group with fewer than ten nights', () => {
		// Review Focus 3. A group in its first month has three nights, not ten.
		openFilm(ada, 'Dune');
		const candidates = candidatesFor(db, groupId);
		expect(candidates).toHaveLength(1);
		expect(Number.isFinite(candidates[0].watchedInWindow)).toBe(true);
	});
});
```

Add the imports these need at the top of the file: `addSuggestion`, `listPool` from `$lib/server/suggestions`; `DEFAULT_GROUP_SETTINGS`, `movieNights` from `$lib/server/db/schema`; `leaveGroup` from `$lib/server/groups`; `eq` from `drizzle-orm`; `DrawLogEntry` from `./draw`; `candidatesFor`, `drawForNight` from `./nights`.

- [ ] **Step 3: Run them and watch them fail**

Run: `npx vitest run src/lib/server/nights.test.ts`
Expected: FAIL — `drawForNight` and `candidatesFor` are not exported.

- [ ] **Step 4: Build the candidate list**

In `src/lib/server/nights.ts`:

```ts
/**
 * The people who can take a turn, with how many of their films the group has
 * WATCHED inside the window.
 *
 * Membership is joined, not assumed: a suggestion whose author has left the
 * group, or is the former-member placeholder, or is a wildcard (`suggested_by
 * IS NULL`), stays in the pool as history and cannot win. The draw draws
 * people, and those are not people who can take a turn.
 */
export function candidatesFor(db: DB, groupId: string): Candidate[] {
	// The window is the last N nights this group actually WATCHED. Drawn and
	// cancelled nights are absent by construction, which is what stops a
	// cancelled night or a re-draw from costing somebody their turn (PRD §6).
	const watchedNightIds = db
		.select({ suggestionId: movieNights.suggestionId })
		.from(movieNights)
		.where(and(eq(movieNights.groupId, groupId), eq(movieNights.status, 'watched')))
		.orderBy(desc(movieNights.scheduledAt))
		.limit(FAIRNESS_WINDOW_NIGHTS)
		.all()
		.map((r) => r.suggestionId)
		.filter((id): id is string => id !== null);

	const watchedBy = new Map<string, number>();
	if (watchedNightIds.length > 0) {
		for (const row of db
			.select({ userId: suggestions.suggestedBy })
			.from(suggestions)
			.where(inArray(suggestions.id, watchedNightIds))
			.all()) {
			if (row.userId) watchedBy.set(row.userId, (watchedBy.get(row.userId) ?? 0) + 1);
		}
	}

	const open = db
		.select({ suggestionId: suggestions.id, userId: suggestions.suggestedBy })
		.from(suggestions)
		.innerJoin(
			memberships,
			and(eq(memberships.userId, suggestions.suggestedBy), eq(memberships.groupId, groupId))
		)
		.where(
			and(
				eq(suggestions.groupId, groupId),
				eq(suggestions.status, 'open'),
				isNull(memberships.leftAt)
			)
		)
		.all();

	const byUser = new Map<string, string[]>();
	for (const row of open) {
		if (!row.userId) continue;
		byUser.set(row.userId, [...(byUser.get(row.userId) ?? []), row.suggestionId]);
	}

	return [...byUser].map(([userId, suggestionIds]) => ({
		userId,
		suggestionIds,
		watchedInWindow: watchedBy.get(userId) ?? 0
	}));
}
```

- [ ] **Step 5: Write the draw**

```ts
/**
 * Synchronous on purpose. Everything from the status check to the write happens
 * inside one transaction with no `await` anywhere in it, because two owners
 * pressing Draw at the same moment must produce one result. This project has
 * fixed read-yield-write on a stale read four times; if a future change wants to
 * await in here, that is the signal to stop rather than to make this async.
 */
export function drawForNight(
	db: DB,
	nightId: string,
	ownerId: string,
	reason?: string
): DrawOutcome {
	const night = db
		.select({ groupId: movieNights.groupId, status: movieNights.status })
		.from(movieNights)
		.where(eq(movieNights.id, nightId))
		.get();
	if (!night) return { ok: false, reason: 'not_found' };
	requireOwner(db, ownerId, night.groupId);

	const settings = requireMember(db, ownerId, night.groupId).settings;
	const candidates = candidatesFor(db, night.groupId);
	if (candidates.length === 0) return { ok: false, reason: 'no_candidates' };

	const seed = newSeed();
	const picked = drawFrom(candidates, settings.drawMode, seed);
	if (!picked) return { ok: false, reason: 'no_candidates' };

	return db.transaction(() => {
		// Test-and-set, not read-then-write: the UPDATE's own WHERE is the guard,
		// so a second caller that got this far finds nothing to update.
		const claimed = db
			.update(movieNights)
			.set({
				status: 'drawn',
				suggestionId: picked.suggestionId,
				drawnAt: new Date(),
				drawSeed: String(seed)
			})
			.where(and(eq(movieNights.id, nightId), eq(movieNights.status, 'scheduled')))
			.run();
		if (claimed.changes === 0) return { ok: false, reason: 'not_scheduled' } as const;

		db.update(suggestions)
			.set({ status: 'drawn' })
			.where(eq(suggestions.id, picked.suggestionId))
			.run();

		const entry: DrawLogEntry = {
			at: new Date().toISOString(),
			seed,
			mode: settings.drawMode,
			candidates: picked.candidates,
			pickedUserId: picked.userId,
			pickedSuggestionId: picked.suggestionId,
			...(reason ? { reason } : {})
		};
		appendDrawLog(db, nightId, entry);

		const title =
			db
				.select({ title: movies.title })
				.from(suggestions)
				.innerJoin(movies, eq(movies.id, suggestions.movieId))
				.where(eq(suggestions.id, picked.suggestionId))
				.get()?.title ?? '';

		return {
			ok: true,
			suggestionId: picked.suggestionId,
			title,
			onlyCandidate: candidates.length === 1 && candidates[0].suggestionIds.length === 1
		} as const;
	});
}

/** Appends. Never overwrites — a re-draw must leave the first result readable. */
function appendDrawLog(db: DB, nightId: string, entry: DrawLogEntry): void {
	const existing =
		(db
			.select({ log: movieNights.drawLog })
			.from(movieNights)
			.where(eq(movieNights.id, nightId))
			.get()?.log as DrawLogEntry[] | null) ?? [];
	db.update(movieNights)
		.set({ drawLog: [...existing, entry] })
		.where(eq(movieNights.id, nightId))
		.run();
}
```

- [ ] **Step 6: Run the tests**

Run: `npx vitest run src/lib/server/nights.test.ts`
Expected: PASS.

- [ ] **Step 7: Prove the concurrency guard is load-bearing**

Change the `.where(...)` on the claiming UPDATE to drop `eq(movieNights.status, 'scheduled')`, leaving only the id. Run the suite: the two-owners test must go RED. Restore it and confirm green. Report both.

A guard nobody has seen fail is not a guard — and this one is invisible in normal use, which is exactly how the setup race reached a review unnoticed earlier in this project.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat(draw): draw a film for a night, once, with a reproducible log"
```

---

## Task 5: Cancelling, re-drawing, and marking a night watched

**Files:**
- Modify: `src/lib/server/nights.ts`, `src/lib/server/nights.test.ts`, `src/lib/i18n/en.json`, `src/lib/i18n/de.json`

**Interfaces:**
- Produces: `cancelNight(db, nightId, ownerId): boolean`; `markWatched(db, nightId, ownerId): boolean`; `redraw(db, nightId, ownerId, reason: string): DrawOutcome`.

**Cancelling and re-drawing both release the film** back to `open`, and neither counts toward anyone's fairness window — the window counts `watched`, so this falls out of Task 4's query rather than needing its own arithmetic. Verify that it really does rather than assuming it.

**A re-draw is permitted exactly once** (§6). Count the log entries: more than one means the override is spent. Both results stay in the log.

**Marking watched is manual and the UI must say so.** Nothing in the MVP moves a night on a timer (PRD §6 defers the automatic draw to v1.0 and couples it to notifications). A group that forgets leaves its films out of every future fairness window, which is Review Focus 5.

- [ ] **Step 1: Add the translation keys**

English:

```json
	"night.cancel": "Cancel this night",
	"night.mark_watched": "We watched it",
	"night.mark_watched_hint": "Nothing marks a night watched automatically. Until somebody does, this film does not count towards anyone's turn.",
	"night.error.not_drawn": "No film has been drawn for this night yet."
```

German:

```json
	"night.cancel": "Filmnacht absagen",
	"night.mark_watched": "Haben wir gesehen",
	"night.mark_watched_hint": "Keine Filmnacht wird automatisch als gesehen markiert. Bis das jemand tut, zählt dieser Film für niemanden als Zug.",
	"night.error.not_drawn": "Für diese Filmnacht wurde noch kein Film gezogen."
```

- [ ] **Step 2: Write the failing tests**

Append to `src/lib/server/nights.test.ts`:

```ts
describe('cancelNight', () => {
	it('releases the drawn film back into the pool', () => {
		addSuggestion(db, {
			groupId,
			userId: ada,
			movie: { title: 'Dune' },
			settings: DEFAULT_GROUP_SETTINGS
		});
		const id = scheduleNight(db, { groupId, userId: ada, scheduledAt: LATER, location: null });
		drawForNight(db, id, ada);

		expect(cancelNight(db, id, ada)).toBe(true);
		expect(nightDetail(db, id, ada)?.status).toBe('cancelled');
		expect(listPool(db, groupId, ada).find((e) => e.title === 'Dune')?.status).toBe('open');
	});

	it('does not cost the member their turn', () => {
		// PRD §6, in as many words: "A night that never happened must not cost a
		// member their turn."
		addSuggestion(db, {
			groupId,
			userId: ada,
			movie: { title: 'Dune' },
			settings: DEFAULT_GROUP_SETTINGS
		});
		const id = scheduleNight(db, { groupId, userId: ada, scheduledAt: LATER, location: null });
		drawForNight(db, id, ada);
		cancelNight(db, id, ada);

		expect(candidatesFor(db, groupId).find((c) => c.userId === ada)?.watchedInWindow).toBe(0);
	});

	it('refuses a non-owner', () => {
		const id = scheduleNight(db, { groupId, userId: ada, scheduledAt: LATER, location: null });
		expect(() => cancelNight(db, id, grace)).toThrow();
	});
});

describe('markWatched', () => {
	it('moves the night to watched and starts counting the film', () => {
		addSuggestion(db, {
			groupId,
			userId: ada,
			movie: { title: 'Dune' },
			settings: DEFAULT_GROUP_SETTINGS
		});
		const id = scheduleNight(db, { groupId, userId: ada, scheduledAt: LATER, location: null });
		drawForNight(db, id, ada);

		expect(markWatched(db, id, ada)).toBe(true);
		expect(nightDetail(db, id, ada)?.status).toBe('watched');

		addSuggestion(db, {
			groupId,
			userId: ada,
			movie: { title: 'Arrival' },
			settings: DEFAULT_GROUP_SETTINGS
		});
		expect(candidatesFor(db, groupId).find((c) => c.userId === ada)?.watchedInWindow).toBe(1);
	});

	it('refuses a night with no film drawn', () => {
		const id = scheduleNight(db, { groupId, userId: ada, scheduledAt: LATER, location: null });
		expect(markWatched(db, id, ada)).toBe(false);
		expect(nightDetail(db, id, ada)?.status).toBe('scheduled');
	});
});

describe('redraw', () => {
	it('releases the first film, picks again, and keeps both in the log', () => {
		addSuggestion(db, {
			groupId,
			userId: ada,
			movie: { title: 'Dune' },
			settings: DEFAULT_GROUP_SETTINGS
		});
		addSuggestion(db, {
			groupId,
			userId: grace,
			movie: { title: 'Arrival' },
			settings: DEFAULT_GROUP_SETTINGS
		});
		const id = scheduleNight(db, { groupId, userId: ada, scheduledAt: LATER, location: null });
		drawForNight(db, id, ada);

		const again = redraw(db, id, ada, 'available nowhere');
		expect(again.ok).toBe(true);

		const log = db
			.select({ log: movieNights.drawLog })
			.from(movieNights)
			.where(eq(movieNights.id, id))
			.get()?.log as DrawLogEntry[];
		expect(log).toHaveLength(2);
		expect(log[1].reason).toBe('available nowhere');
		// Exactly one film is drawn: the first was released.
		expect(listPool(db, groupId, ada).filter((e) => e.status === 'drawn')).toHaveLength(1);
	});

	it('permits the override exactly once', () => {
		for (const title of ['Dune', 'Arrival', 'Solaris']) {
			addSuggestion(db, {
				groupId,
				userId: ada,
				movie: { title },
				settings: DEFAULT_GROUP_SETTINGS
			});
		}
		const id = scheduleNight(db, { groupId, userId: ada, scheduledAt: LATER, location: null });
		drawForNight(db, id, ada);
		expect(redraw(db, id, ada, 'first reason').ok).toBe(true);
		expect(redraw(db, id, ada, 'second reason')).toEqual({ ok: false, reason: 'redraw_used' });
	});

	it('refuses when only one film exists rather than appearing to reroll', () => {
		// Review Focus 4. Re-drawing a one-film pool can only return that film, and
		// pretending otherwise is worse than saying so.
		addSuggestion(db, {
			groupId,
			userId: ada,
			movie: { title: 'Dune' },
			settings: DEFAULT_GROUP_SETTINGS
		});
		const id = scheduleNight(db, { groupId, userId: ada, scheduledAt: LATER, location: null });
		drawForNight(db, id, ada);
		expect(redraw(db, id, ada, 'nope')).toEqual({ ok: false, reason: 'sole_suggestion' });
	});
});
```

- [ ] **Step 3: Run them and watch them fail**

Run: `npx vitest run src/lib/server/nights.test.ts`
Expected: FAIL — `cancelNight`, `markWatched` and `redraw` are not exported.

- [ ] **Step 4: Implement the three transitions**

Each one: `requireOwner` first; then a single transaction whose UPDATE carries the expected status in its `WHERE`, so the transition is a test-and-set exactly as in Task 4. `cancelNight` and `redraw` both set the previously drawn suggestion back to `status: 'open'` before anything else. `redraw` counts the existing log entries and returns `{ ok: false, reason: 'redraw_used' }` at two or more, and returns `{ ok: false, reason: 'sole_suggestion' }` when `candidatesFor` plus the released film amounts to one suggestion in total.

`redraw` keeps one implementation of the draw rather than two that can drift: in a single transaction it releases the drawn suggestion back to `open` **and sets the night back to `'scheduled'`**, then calls `drawForNight(db, nightId, ownerId, reason)` unchanged.

Do **not** add a parameter for the expected prior status. `drawForNight`'s test-and-set on `'scheduled'` is the concurrency guard from Task 4, and widening it to accept `'drawn'` would let two simultaneous re-draws both succeed. Returning the night to `'scheduled'` first is also the honest state: the pool is open again and no film is chosen. The released suggestion is excluded from its own re-draw by nothing at all — it is eligible again, which is correct, and the `sole_suggestion` guard is what stops a one-film pool from pretending to reroll.

- [ ] **Step 5: Run the tests**

Run: `npx vitest run src/lib/server/nights.test.ts`
Expected: PASS.

- [ ] **Step 6: Verify the fairness window really does fall out of the query**

Confirm by mutation rather than by reading: change `candidatesFor`'s window filter from `eq(movieNights.status, 'watched')` to `inArray(movieNights.status, ['watched', 'drawn'])`. The "does not cost the member their turn" test must go RED. Restore and confirm green.

This is the Global Constraint at the top of the plan. It is the one thing here that no user will ever report as a bug — they will simply feel the app is unfair.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat(nights): cancel, re-draw once, and mark a night watched"
```

---

## Task 6: The pages

**Files:**
- Create: `src/routes/groups/[groupId]/nights/+page.server.ts`, `+page.svelte`, `src/routes/groups/[groupId]/nights/[nightId]/+page.server.ts`, `+page.svelte`, `night.test.ts`
- Modify: `src/routes/groups/[groupId]/+page.svelte` (a link to the nights list), `src/lib/i18n/en.json`, `src/lib/i18n/de.json`

**Interfaces:**
- Consumes: everything from Tasks 2, 4 and 5; `requireUser` (`./groups`); `getTimezone` (`./settings`).
- Produces: `/groups/<id>/nights` and `/groups/<id>/nights/<nightId>`.

**`resultVisible` must be honoured, and it is the one thing in this task that is a security property rather than a layout choice.** `GroupSettings.resultVisible` is `'immediately' | 'on_night'`. With `'on_night'`, the drawn title must not be in the payload the server sends before `scheduledAt` has passed — **not merely hidden in the markup**. A title withheld with `{#if}` while sitting in `data` is visible to anybody who opens the page source, which is a worse failure than not having the setting at all, because the group was told the film was a surprise.

**All times render in the instance timezone**, from `getTimezone(db)`, using `Intl.DateTimeFormat`. The column is UTC (PRD §6, §12).

- [ ] **Step 1: Write the failing route test**

`src/routes/groups/[groupId]/nights/[nightId]/night.test.ts`, following the harness in `src/routes/reset/reset.test.ts` — in-memory DB, `vi.mock('$lib/server/db')`, a `post()` helper per action. Cover:

```ts
	it('withholds the drawn title from the payload until the night, when set to on_night', async () => {
		// Not an {#if} in the markup: a title present in `data` is readable in the
		// page source, and the group was told the film was a surprise.
		const { load } = await import('./+page.server');
		setGroupSettings(db, groupId, { ...DEFAULT_GROUP_SETTINGS, resultVisible: 'on_night' });
		const data = await load({
			params: { groupId, nightId },
			locals: { user: { id: ada, displayName: 'Ada', isAdmin: false }, locale: 'en' }
		} as never);
		expect(JSON.stringify(data)).not.toContain('Dune');
	});

	it('includes it once the night has passed', async () => { /* scheduledAt in the past */ });

	it('includes it immediately when set to immediately', async () => { /* the default */ });

	it('refuses a non-member with the same answer as a night that does not exist', async () => {
		// 404 for both. A non-member must not learn that a group they cannot see
		// has nights in it.
	});

	it('refuses every action to a non-owner except RSVP', async () => {
		// draw, redraw, cancel, markWatched are owner-only; respond is not.
	});
```

Whether `setGroupSettings` exists is worth checking before relying on it — `createGroup` takes settings, and if there is no setter, write the settings row directly in the test rather than adding a production helper no route needs.

- [ ] **Step 2: Run them and watch them fail**

Run: `npx vitest run "src/routes/groups/[groupId]/nights"`
Expected: FAIL — the route does not exist.

- [ ] **Step 3: The nights list route**

`load`: `requireUser`, then `requireMember` against `params.groupId` **before** reading anything, then `listNights`. Return the group name, the nights, whether the viewer owns the group, and the instance timezone.

One action, `schedule`: owner-only. Parse `when` from a `datetime-local` input, which arrives as a wall-clock string with no zone — interpret it **in the instance timezone**, not the server's, and store the resulting instant. Reject a past moment with `nights.error.past` and an unparseable one with `nights.error.when`. Everything after the last `await` stays synchronous.

- [ ] **Step 4: The nights list page**

A list ordered soonest-first, each row showing the date in the instance timezone, the location, the status badge, and the yes/no/maybe counts. Owner sees a schedule form: `<input type="datetime-local" name="when" required>`, an optional location with `maxlength="120"`, and a submit. `min-h-11` on every control, `role="alert"` on errors, no JavaScript.

- [ ] **Step 5: The night detail route**

`load`: `requireUser` → `requireMember` → `nightDetail`. Return `null`-equivalent 404 for both a missing night and a non-member, identically. Compute `resultVisible` server-side and **omit** `drawnTitle` and `drawnBy` from the returned object when the film is not yet showable.

Actions: `respond` (any member), and `draw`, `redraw`, `cancel`, `markWatched` (owner-only, each mapping a `DrawOutcome` `reason` onto its `night.error.*` key). `redraw` requires a non-empty reason, which goes into the log.

- [ ] **Step 6: The night detail page**

The date in the instance timezone, the location, the RSVP buttons with the viewer's current answer marked, and the responses list. When a film is drawn and showable, render `night.drawn` — or `night.drawn_one` when `onlyCandidate` was true, and `night.drawn_former` when the suggester is the former-member placeholder. Owner controls sit behind the relevant status, and `night.mark_watched_hint` is always visible next to the watched button.

- [ ] **Step 7: Verify and commit**

Full gates. Then by hand on **`node build/index.js`** (never `vite dev`): schedule a night, RSVP from a second account, draw, re-draw once, confirm the second re-draw is refused, cancel another night and confirm its film returns to the pool.

Then set a group to `resultVisible: 'on_night'` and **read the page source** to confirm the title is genuinely absent, not merely unrendered.

```bash
git add -A
git commit -m "feat(nights): schedule, draw and settle a movie night from the UI"
```

---

## Task 7: The whole-flow walkthrough

**Files:**
- Modify: whatever the walkthrough shows to be wrong. If nothing is, this task changes no code and says so.

This task exists because two walkthroughs on Plan 3 passed while real regressions were live — each only walked the path somebody had thought to walk — and because the serious findings on Plans 3 and 4 both lived **between** tasks that were individually correct.

- [ ] **Step 1: Build and run the real thing**

```bash
npm run build
mkdir -p /tmp/fn-draw
DATABASE_PATH=/tmp/fn-draw/filmnacht.db ORIGIN=http://localhost:5608 node build/index.js
```

Throwaway database. Never `data/`. Port 5599 belongs to the user's own instance — leave it alone.

- [ ] **Step 2: Walk a season**

Setup → group → invite two more accounts → each adds two or three films → schedule a night → draw → mark watched → schedule another → draw → watched, six or seven nights running. Then check by direct SQL that the fairness window is doing what it claims: nobody should have won markedly more often than anybody else, and `candidatesFor`'s weights should favour whoever has waited longest.

- [ ] **Step 3: Deviate deliberately**

At minimum:
- Draw, then cancel, then draw again for a new night — the released film must be eligible and its owner must not have been charged a turn.
- Re-draw, then cancel, then try to re-draw the replacement.
- Have a member withdraw the film that is currently drawn for a night.
- Have a member leave the group between suggesting and the draw.
- Schedule two nights for the same evening and draw both.
- Draw with every member having exactly one film, then with one member having ten.
- Set `resultVisible: 'on_night'` and read the page source, not the rendering.
- Cross-origin POSTs to every new action — 403, and that claim is only meaningful on this production build.
- Open the same night in two tabs and press Draw in both.
- Anything the six task reviews would each have considered somebody else's problem.

- [ ] **Step 4: Report, then fix or state that nothing needed fixing**

Write what you observed, not what should have happened. Then commit any fixes.

```bash
git add -A
git commit -m "fix(nights): <what the walkthrough found>"
```
