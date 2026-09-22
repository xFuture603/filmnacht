# filmnacht — Plan 2: Movie Pool Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A group can fill a pool with films — typed in by hand, or found through TMDB search — without anyone seeing who suggested what, with duplicates refused and a per-member cap enforced.

**Architecture:** Same shape as Plan 1: pure functions in `src/lib/server/**` taking the Drizzle `db` handle first, routes as thin wrappers. The TMDB client takes its API key and its `fetch` as parameters, so it is testable against fixtures with no key and no network. The `movies` table is a local cache: a film's metadata is fetched once and read from SQLite forever after.

**Tech Stack:** Unchanged from Plan 1 — SvelteKit 2 / Svelte 5, better-sqlite3 + Drizzle, Tailwind 4 + daisyUI 5, Vitest.

**Spec:** `prd.md` (sections 5 and 10 bind this plan; §4's `maxOpenSuggestions` setting and §12's constraints apply)

**Predecessor:** `docs/superpowers/plans/2026-09-21-foundation-access.md` (merged). Its decision log is at `docs/superpowers/2026-09-21-foundation-access-decisions.md` and is worth skimming — several of its rulings bind this plan.

## Global Constraints

Carried forward from Plan 1, all still binding:

- Node 24, npm. Prettier (tabs, single quotes, no trailing commas, 100 cols) enforced by `npm run lint`.
- **English is the source language in code.** Every user-facing string goes through `t(locale, key)`; every new key lands in **both** `en.json` and `de.json`, which are at full parity and must stay there.
- All timestamps stored UTC as integer unix seconds via Drizzle `{ mode: 'timestamp' }`.
- **No module under `src/lib/server/**` may import `$env/*`**, with the single exception of `src/lib/server/db/index.ts`. A module that needs a secret takes it as a parameter. **Routes may read env** — a route is the boundary where a secret enters the system, and Task 7 does exactly that with `TMDB_API_KEY`. The rule exists so every server module stays unit-testable without SvelteKit's runtime, not to ban env everywhere.
- Every group query is checked server-side against membership. A non-member gets **404, never 403** — `requireMember` already guarantees this and must not be bypassed.
- Accessibility is binding, not polish: every *interactive* control at least 44px (`min-h-11`) — a non-interactive badge is exempt, a `readonly` input is not; `role="alert"` on error banners; alt text on every poster.
- Server-side `error(...)` message strings stay English as developer-facing log labels. Translation happens in `src/routes/+error.svelte`, keyed off `page.status`.
- `src/lib/server/redirect.ts` exports `safeRedirectPath`. Never open-code a `startsWith('/')` same-origin check.
- **Past the last `await` in a handler, nothing yields** — better-sqlite3 is synchronous and Node single-threaded. Before it, that guarantee does not exist. Plan 1 shipped this defect twice; check every handler that reads then writes.
- Inside `db.transaction(...)`, passing the outer `db` handle to helpers is correct and deliberate on better-sqlite3 (one connection, so `BEGIN` covers every statement). `src/lib/server/setup.ts` documents this. Do not thread `tx` through shared helpers.

New for this plan:

- **The app must be fully usable with no TMDB API key.** Manual entry is the mandated path, not the fallback-of-last-resort; it ships first, in Task 6, and TMDB search is added on top in Task 7. With no key configured, the search UI is hidden with a visible reason and manual entry is unaffected.
- **No network calls in tests.** The TMDB client takes `fetch` as a parameter; every test passes a fixture.
- **The pool is anonymous before the draw.** No response that a member can reach may reveal who suggested a film they did not suggest — not in the HTML, not in a data attribute, not in a JSON payload.

## Deviations from the spec, with rationale

1. **Search results show poster, title, year and TMDB rating — not director.** PRD §5 asks for "poster, year, director and runtime" per result. TMDB's `/search/movie` returns neither director nor runtime; director needs a `/movie/{id}/credits` call and runtime a `/movie/{id}` call, so honouring §5 literally costs two extra API requests *per result* on every keystroke-driven search. Worse, **PRD §10's `movie` table has no `director` column**, so a director could be displayed but never cached — every later view would have to phone TMDB again. Runtime is fetched and cached when a film is adopted, and shown from then on. If director matters, it needs a schema column and belongs in a plan that adds one.
2. **`suggestions.status` gains no new values.** PRD §5's "films already drawn leave the pool (configurable)" is implemented as a read filter on `status`, not a fourth state. The `repeatDrawnFilms` group setting flips whether `drawn` suggestions are excluded from the pool view. The draw itself is Plan 3; this plan only ensures the filter exists and is honoured.
3. **Poster images are hot-linked to TMDB's CDN, not proxied or stored.** PRD §12 says "no external fonts — everything served locally" and "outgoing connections go to TMDB only, and only for metadata". A poster is metadata's payload, and mirroring TMDB's image CDN into the SQLite volume is a caching subsystem this MVP does not need. The consequence is honest and worth recording: a member's browser contacts `image.tmdb.org` when viewing a pool. If that is unacceptable, proxying posters through the instance is a contained follow-up.

---

## File Structure

| File | Responsibility |
| --- | --- |
| `src/lib/server/dedupe.ts` | `dedupeKey()` — the one place a film's identity is computed. Pure. |
| `src/lib/server/tmdb.ts` | TMDB search and detail fetch. Takes key and `fetch` as parameters; no env, no global state. |
| `src/lib/server/movies.ts` | The local movie cache: find-or-create a `movies` row from TMDB data or manual input. |
| `src/lib/server/suggestions.ts` | Pool commands and queries: add, withdraw, list. Owns the cap and anonymity rules. |
| `src/lib/server/groups.ts` | *(modified)* gains `requireUser` and `requireOwner`. |
| `src/lib/server/setup.ts` | *(modified)* gains `guardRedirect`, extracted from `hooks.server.ts` so the guard's truth table is testable. |
| `src/routes/groups/[groupId]/+page.svelte` | *(modified)* becomes the pool view. |
| `src/routes/groups/[groupId]/add/` | The add-a-film flow: manual form, then TMDB search on top. |

---

## Task 1: Authorization helpers and a testable setup guard

Plan 1's final review flagged three gaps that get more expensive with every route added. Plan 3 adds at least five owner-gated actions; this task pays the debt before that.

**Files:**
- Modify: `src/lib/server/groups.ts`, `src/lib/server/groups.test.ts`, `src/lib/server/setup.ts`, `src/lib/server/setup.test.ts`, `src/hooks.server.ts`
- Modify: `src/routes/groups/+page.server.ts`, `src/routes/groups/[groupId]/+page.server.ts`, `src/routes/profile/+page.server.ts`

**Interfaces:**
- Consumes: `requireMember`, `SessionUser`, `isSetupComplete` (Plan 1).
- Produces:
  - `requireUser(locals: App.Locals): SessionUser` — throws SvelteKit 401 when signed out
  - `requireOwner(db: DB, userId: string, groupId: string): GroupMembership` — 404 for a non-member, 403 for a member who is not the owner
  - `guardRedirect(pathname: string, setupComplete: boolean): string | null`

- [ ] **Step 1: Write the failing tests**

Append to `src/lib/server/groups.test.ts`:

```ts
describe('requireUser', () => {
	it('returns the user when signed in', () => {
		const user = { id: 'u1', displayName: 'Ada', isAdmin: false };
		expect(requireUser({ user, locale: 'en' })).toBe(user);
	});

	it('throws 401 when signed out', () => {
		expect(status(() => requireUser({ user: null, locale: 'en' }))).toBe(401);
	});
});

describe('requireOwner', () => {
	it('returns the membership for the owner', () => {
		const id = createGroup(db, { name: 'Movie Club', ownerId: ada });
		expect(requireOwner(db, ada, id).role).toBe('owner');
	});

	it('throws 403 for a member who is not the owner', () => {
		const id = createGroup(db, { name: 'Movie Club', ownerId: ada });
		addMember(db, grace, id);
		expect(status(() => requireOwner(db, grace, id))).toBe(403);
	});

	it('throws 404 — not 403 — for a non-member, so the id is not confirmed', () => {
		const id = createGroup(db, { name: 'Movie Club', ownerId: ada });
		expect(status(() => requireOwner(db, grace, id))).toBe(404);
	});

	it('throws 404 for a group that does not exist', () => {
		expect(status(() => requireOwner(db, ada, 'made-up-id'))).toBe(404);
	});
});
```

Append to `src/lib/server/setup.test.ts`:

```ts
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
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/lib/server/groups.test.ts src/lib/server/setup.test.ts`
Expected: FAIL — `requireUser`, `requireOwner` and `guardRedirect` are not exported.

- [ ] **Step 3: Implement the helpers**

Append to `src/lib/server/groups.ts`:

```ts
/**
 * The only place a route should turn "signed in?" into a user. The message is a
 * developer-facing log label; +error.svelte renders the translated text.
 */
export function requireUser(locals: App.Locals): SessionUser {
	if (!locals.user) error(401, 'Sign in first');
	return locals.user;
}

/**
 * 404 for a non-member and 403 for a member who is not the owner. The asymmetry
 * is deliberate: 404 hides whether the group exists from someone who has no
 * business knowing, while a confirmed member already knows it exists, so 403
 * leaks nothing new and says something useful.
 */
export function requireOwner(db: DB, userId: string, groupId: string): GroupMembership {
	const membership = requireMember(db, userId, groupId);
	if (membership.role !== 'owner') error(403, 'Only the owner can do that');
	return membership;
}
```

Add `import type { SessionUser } from './auth/session';` to that file's imports.

Append to `src/lib/server/setup.ts`:

```ts
/**
 * Where a request must be sent before it reaches a page, or null to let it
 * through. Extracted from the hook so the interaction between the two rules is
 * testable: merging them into one condition silently kills the language
 * switcher after setup, which is a bug this project has already shipped once.
 */
export function guardRedirect(pathname: string, setupComplete: boolean): string | null {
	const setupPath = pathname.startsWith('/setup');
	const localeRoute = pathname === '/locale';
	if (!setupComplete && !setupPath && !localeRoute) return '/setup';
	if (setupComplete && setupPath) return '/';
	return null;
}
```

- [ ] **Step 4: Use them**

In `src/hooks.server.ts`, replace the inline guard block with:

```ts
	const target = guardRedirect(event.url.pathname, isSetupComplete(db));
	if (target) redirect(303, target);
```

Replace every `if (!locals.user) error(401, 'Sign in first');` in the three route files with `const user = requireUser(locals);` and use `user.id` below it. Replace the inline owner check in `src/routes/groups/[groupId]/+page.server.ts` with `requireOwner(db, user.id, params.groupId)`.

**Then remove the now-unused `error` import from each of those three route files.** All three currently import `error` from `@sveltejs/kit` solely for the 401 and the inline owner check; once both move behind helpers, the import is dead and `npm run lint` fails on it. `fail` stays — it is still used for form errors.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npm test`
Expected: PASS, 98 tests (88 + 10 new).

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "refactor(auth): extract requireUser, requireOwner and the setup guard"
```

---

## Task 2: The dedupe key

**Files:**
- Create: `src/lib/server/dedupe.ts`, `src/lib/server/dedupe.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `dedupeKey(input: { tmdbId?: number | null; title: string; year?: number | null }): string`

PRD §5: matching cannot rely on `tmdb_id` alone, because a hand-entered film has none — otherwise two people add "Dune" by hand and the pool quietly holds both. The key is `tmdb:<id>` where an id exists and `manual:<slugified-title>:<year>` where it does not, unique per group.

- [ ] **Step 1: Write the failing test**

`src/lib/server/dedupe.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { dedupeKey } from './dedupe';

describe('dedupeKey', () => {
	it('prefers the TMDB id when there is one', () => {
		expect(dedupeKey({ tmdbId: 438631, title: 'Dune', year: 2021 })).toBe('tmdb:438631');
	});

	it('falls back to title and year without an id', () => {
		expect(dedupeKey({ title: 'Dune', year: 2021 })).toBe('manual:dune:2021');
	});

	it('treats the same hand-typed film as the same film', () => {
		const a = dedupeKey({ title: 'Dune', year: 2021 });
		const b = dedupeKey({ title: '  dune  ', year: 2021 });
		const c = dedupeKey({ title: 'DUNE', year: 2021 });
		expect(new Set([a, b, c]).size).toBe(1);
	});

	it('collapses punctuation and spacing so near-identical typings collide', () => {
		expect(dedupeKey({ title: 'Spider-Man: No Way Home', year: 2021 })).toBe(
			dedupeKey({ title: 'Spider Man  No Way Home', year: 2021 })
		);
	});

	it('folds diacritics, so the same film typed two ways is one film', () => {
		expect(dedupeKey({ title: 'Amélie', year: 2001 })).toBe(
			dedupeKey({ title: 'Amelie', year: 2001 })
		);
	});

	it('keeps different years apart', () => {
		expect(dedupeKey({ title: 'Dune', year: 2021 })).not.toBe(
			dedupeKey({ title: 'Dune', year: 1984 })
		);
	});

	it('handles a missing year without colliding with a real one', () => {
		expect(dedupeKey({ title: 'Dune' })).toBe('manual:dune:');
		expect(dedupeKey({ title: 'Dune' })).not.toBe(dedupeKey({ title: 'Dune', year: 2021 }));
	});

	it('does not collapse two genuinely different films into one key', () => {
		expect(dedupeKey({ title: 'Dune', year: 2021 })).not.toBe(
			dedupeKey({ title: 'Dune Part Two', year: 2024 })
		);
	});

	it('survives a title with no alphanumeric characters at all', () => {
		expect(dedupeKey({ title: '!!!', year: 2009 })).toBe('manual::2009');
	});
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/lib/server/dedupe.test.ts`
Expected: FAIL — cannot resolve `./dedupe`.

- [ ] **Step 3: Write the implementation**

`src/lib/server/dedupe.ts`:

```ts
/**
 * A film's identity within one group's pool, unique per group.
 *
 * A TMDB id is authoritative when present. Without one — a hand-entered film —
 * the title has to do the work, so it is normalised hard: diacritics folded,
 * punctuation collapsed, case and spacing ignored. Two people typing "Amélie"
 * and "Amelie" mean the same film, and the pool must say so rather than
 * quietly holding both (PRD §5).
 */
/**
 * German transliterates these to digraphs, not to bare vowels: "Mueller" and
 * the umlaut spelling are one name, and NFD alone would split them. Applied
 * after NFC so a decomposed umlaut recomposes first and cannot slip past.
 */
const GERMAN_DIGRAPHS: Record<string, string> = {
	'ä': 'ae',
	'ö': 'oe',
	'ü': 'ue',
	'ß': 'ss'
};

export function dedupeKey(input: {
	tmdbId?: number | null;
	title: string;
	year?: number | null;
}): string {
	if (input.tmdbId != null) return `tmdb:${input.tmdbId}`;
	const slug = input.title
		.toLowerCase()
		// Recompose first: the digraph map matches single precomposed code points,
		// so decomposed input (base letter + combining mark, routine from macOS
		// and from already-normalised sources) would otherwise slip past it and be
		// stripped to a bare vowel instead of a digraph.
		.normalize('NFC')
		.replace(/[äöüß]/g, (character) => GERMAN_DIGRAPHS[character])
		.normalize('NFD')
		// Strip remaining combining marks (U+0300-U+036F), so an acute accent
		// folds away. Written as escapes on purpose: the literal characters are
		// invisible in source and get eaten by tooling that is not escape-safe.
		.replace(/[\u0300-\u036f]/g, '')
		// Keep letters and digits in ANY script. An ASCII-only class collapses
		// every Cyrillic, Japanese or Greek title to the empty slug, so two
		// different foreign films from the same year would be judged duplicates.
		.replace(/[^\p{Letter}\p{Number}]+/gu, '-')
		.replace(/^-+|-+$/g, '');
	return `manual:${slug}:${input.year ?? ''}`;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/lib/server/dedupe.test.ts`
Report the count you observe.

> **Five further tests were added during review**, and they are the ones that
> matter most: two different titles in the **same year** must differ (the
> original compared different years, so it passed even with the slug ignored);
> German ss/umlaut spellings must collide; non-Latin titles must keep their
> characters instead of collapsing to an empty slug; two different non-Latin
> titles in the same year must differ; and a **decomposed** umlaut must key the
> same as a precomposed one, with the fixture built by `String.fromCharCode`
> and length-asserted so it cannot silently become precomposed.

- [ ] **Step 5: Commit**

```bash
git add src/lib/server/dedupe.ts src/lib/server/dedupe.test.ts
git commit -m "feat(pool): dedupe key that folds diacritics and punctuation"
```

---

## Task 3: The TMDB client

**Files:**
- Create: `src/lib/server/tmdb.ts`, `src/lib/server/tmdb.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `type TmdbSearchResult = { tmdbId: number; title: string; year: number | null; posterUrl: string | null; tmdbRating: number | null }`
  - `type TmdbMovieDetail = TmdbSearchResult & { runtime: number | null; genres: string[] }`
  - `searchMovies(apiKey: string, query: string, fetchImpl?: typeof fetch): Promise<TmdbSearchResult[]>`
  - `fetchMovie(apiKey: string, tmdbId: number, fetchImpl?: typeof fetch): Promise<TmdbMovieDetail | null>`

**On the response shapes.** These follow TMDB's documented v3 API: `/search/movie` returns `{ results: [{ id, title, release_date, poster_path, vote_average }] }` and `/movie/{id}` adds `runtime` and `genres: [{ id, name }]`. Images are served from `https://image.tmdb.org/t/p/w342{poster_path}`. **The tests use fixtures and need no key and no network** — but if a real key is available, do a single manual sanity call and report any field that differs from the fixtures, because a wrong shape here fails at runtime with a key and silently passes without one.

- [ ] **Step 1: Write the failing test**

`src/lib/server/tmdb.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import { fetchMovie, searchMovies } from './tmdb';

function jsonResponse(body: unknown, status = 200) {
	return new Response(JSON.stringify(body), { status });
}

const SEARCH_FIXTURE = {
	results: [
		{
			id: 438631,
			title: 'Dune',
			release_date: '2021-09-15',
			poster_path: '/d5NXSklXo0qyIYkgV94XAgMIckC.jpg',
			vote_average: 7.8
		},
		{ id: 841, title: 'Dune', release_date: '1984-12-14', poster_path: null, vote_average: 6.2 },
		{ id: 99, title: 'Unreleased', release_date: '', poster_path: null, vote_average: 0 }
	]
};

describe('searchMovies', () => {
	it('maps results to the shape the app stores', async () => {
		const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(SEARCH_FIXTURE));
		const results = await searchMovies('KEY', 'dune', fetchImpl);
		expect(results[0]).toEqual({
			tmdbId: 438631,
			title: 'Dune',
			year: 2021,
			posterUrl: 'https://image.tmdb.org/t/p/w342/d5NXSklXo0qyIYkgV94XAgMIckC.jpg',
			tmdbRating: 7.8
		});
	});

	it('turns a missing poster into null rather than a broken URL', async () => {
		const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(SEARCH_FIXTURE));
		expect((await searchMovies('KEY', 'dune', fetchImpl))[1].posterUrl).toBeNull();
	});

	it('turns an unparseable release date into a null year', async () => {
		const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(SEARCH_FIXTURE));
		expect((await searchMovies('KEY', 'dune', fetchImpl))[2].year).toBeNull();
	});

	it('sends the key and url-encodes the query', async () => {
		const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ results: [] }));
		await searchMovies('KEY', 'no way home', fetchImpl);
		const url = String(fetchImpl.mock.calls[0][0]);
		expect(url).toContain('api_key=KEY');
		expect(url).toContain('query=no%20way%20home');
		expect(url).toContain('include_adult=false');
	});

	it('returns an empty list when TMDB finds nothing', async () => {
		const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ results: [] }));
		expect(await searchMovies('KEY', 'zzzz', fetchImpl)).toEqual([]);
	});

	it('throws when TMDB refuses, so the route can offer manual entry instead', async () => {
		const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ status_message: 'nope' }, 401));
		await expect(searchMovies('BAD', 'dune', fetchImpl)).rejects.toThrow(/401/);
	});

	it('does not put the key in the thrown message', async () => {
		const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({}, 500));
		await expect(searchMovies('SECRET-KEY', 'dune', fetchImpl)).rejects.not.toThrow(
			/SECRET-KEY/
		);
	});
});

describe('fetchMovie', () => {
	it('returns the details the movies table caches', async () => {
		const fetchImpl = vi.fn().mockResolvedValue(
			jsonResponse({
				id: 438631,
				title: 'Dune',
				release_date: '2021-09-15',
				poster_path: '/p.jpg',
				vote_average: 7.8,
				runtime: 155,
				genres: [
					{ id: 878, name: 'Science Fiction' },
					{ id: 12, name: 'Adventure' }
				]
			})
		);
		expect(await fetchMovie('KEY', 438631, fetchImpl)).toEqual({
			tmdbId: 438631,
			title: 'Dune',
			year: 2021,
			posterUrl: 'https://image.tmdb.org/t/p/w342/p.jpg',
			tmdbRating: 7.8,
			runtime: 155,
			genres: ['Science Fiction', 'Adventure']
		});
	});

	it('returns null for a film TMDB does not have', async () => {
		const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({}, 404));
		expect(await fetchMovie('KEY', 1, fetchImpl)).toBeNull();
	});
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/lib/server/tmdb.test.ts`
Expected: FAIL — cannot resolve `./tmdb`.

- [ ] **Step 3: Write the implementation**

`src/lib/server/tmdb.ts`:

```ts
const API = 'https://api.themoviedb.org/3';
const POSTER = 'https://image.tmdb.org/t/p/w342';

export type TmdbSearchResult = {
	tmdbId: number;
	title: string;
	year: number | null;
	posterUrl: string | null;
	tmdbRating: number | null;
};

export type TmdbMovieDetail = TmdbSearchResult & {
	runtime: number | null;
	genres: string[];
};

function yearOf(releaseDate: unknown): number | null {
	const year = Number(String(releaseDate ?? '').slice(0, 4));
	return Number.isInteger(year) && year > 1800 ? year : null;
}

function posterFrom(path: unknown): string | null {
	return typeof path === 'string' && path ? `${POSTER}${path}` : null;
}

function ratingFrom(value: unknown): number | null {
	return typeof value === 'number' && value > 0 ? value : null;
}

/** Never interpolate the key into anything that could be logged or rendered. */
function refuse(what: string, status: number): never {
	throw new Error(`TMDB ${what} failed with status ${status}`);
}

export async function searchMovies(
	apiKey: string,
	query: string,
	fetchImpl: typeof fetch = fetch
): Promise<TmdbSearchResult[]> {
	const url = `${API}/search/movie?api_key=${encodeURIComponent(apiKey)}&include_adult=false&query=${encodeURIComponent(query)}`;
	const response = await fetchImpl(url);
	if (!response.ok) refuse('search', response.status);
	const body = (await response.json()) as { results?: unknown[] };
	return (body.results ?? []).map((raw) => {
		const item = raw as Record<string, unknown>;
		return {
			tmdbId: Number(item.id),
			title: String(item.title ?? ''),
			year: yearOf(item.release_date),
			posterUrl: posterFrom(item.poster_path),
			tmdbRating: ratingFrom(item.vote_average)
		};
	});
}

export async function fetchMovie(
	apiKey: string,
	tmdbId: number,
	fetchImpl: typeof fetch = fetch
): Promise<TmdbMovieDetail | null> {
	const url = `${API}/movie/${tmdbId}?api_key=${encodeURIComponent(apiKey)}`;
	const response = await fetchImpl(url);
	if (response.status === 404) return null;
	if (!response.ok) refuse('detail lookup', response.status);
	const item = (await response.json()) as Record<string, unknown>;
	const genres = Array.isArray(item.genres)
		? (item.genres as { name?: unknown }[]).map((g) => String(g.name ?? '')).filter(Boolean)
		: [];
	return {
		tmdbId: Number(item.id),
		title: String(item.title ?? ''),
		year: yearOf(item.release_date),
		posterUrl: posterFrom(item.poster_path),
		tmdbRating: ratingFrom(item.vote_average),
		runtime: typeof item.runtime === 'number' && item.runtime > 0 ? item.runtime : null,
		genres
	};
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/lib/server/tmdb.test.ts`
Expected: PASS, 9 tests.

- [ ] **Step 5: Add the key to `.env.example`**

```bash
# Optional. Without it the app works fully — films are added by hand instead of
# searched. Get one free (non-commercial) at https://www.themoviedb.org/settings/api
# TMDB_API_KEY=
```

- [ ] **Step 6: Commit**

```bash
git add src/lib/server/tmdb.ts src/lib/server/tmdb.test.ts .env.example
git commit -m "feat(pool): TMDB search and detail client with injectable fetch"
```

---

## Task 4: The movie cache and the pool commands

**Files:**
- Create: `src/lib/server/movies.ts`, `src/lib/server/suggestions.ts`, `src/lib/server/suggestions.test.ts`

**Interfaces:**
- Consumes: `DB`, `movies`, `suggestions` (Plan 1 schema); `dedupeKey` (Task 2); `GroupSettings`, `DEFAULT_GROUP_SETTINGS`.
- Produces:
  - `type MovieInput = { tmdbId?: number | null; title: string; year?: number | null; posterUrl?: string | null; runtime?: number | null; genres?: string[] | null; tmdbRating?: number | null }`
  - `findOrCreateMovie(db: DB, input: MovieInput): string`
  - `type AddResult = { ok: true; suggestionId: string } | { ok: false; reason: 'duplicate' | 'cap_reached' | 'bad_title' }`
  - `addSuggestion(db: DB, input: { groupId: string; userId: string; movie: MovieInput; note?: string | null; settings: GroupSettings }): AddResult`
  - `withdrawSuggestion(db: DB, userId: string, suggestionId: string): 'ok' | 'not_found' | 'already_drawn'`
  - `type PoolEntry = { suggestionId: string; title: string; year: number | null; posterUrl: string | null; runtime: number | null; mine: boolean; status: 'open' | 'drawn' }`
  - `listPool(db: DB, groupId: string, viewerId: string, settings: GroupSettings): PoolEntry[]`
  - `countOpenSuggestions(db: DB, groupId: string, userId: string): number`
  - `NOTE_MAX = 200`

**The anonymity rule is enforced by the type.** `PoolEntry` has a `mine` boolean and no author field at all, so there is no way for a route or a component to leak another member's identity — it never receives it. PRD §5: who suggested a film is revealed with the draw, not before.

- [ ] **Step 1: Write the failing test**

`src/lib/server/suggestions.test.ts`:

```ts
import { beforeEach, describe, expect, it } from 'vitest';
import { applyMigrations, createDb, type DB } from './db/client';
import { DEFAULT_GROUP_SETTINGS, suggestions, type GroupSettings } from './db/schema';
import { createGroup, addMember } from './groups';
import { addSuggestion, countOpenSuggestions, listPool, withdrawSuggestion } from './suggestions';
import { createUser } from './users';
import { eq } from 'drizzle-orm';

let db: DB;
let ada: string;
let grace: string;
let groupId: string;
const settings: GroupSettings = DEFAULT_GROUP_SETTINGS;

const dune = { tmdbId: 438631, title: 'Dune', year: 2021, posterUrl: '/p.jpg', runtime: 155 };
const arrival = { tmdbId: 329865, title: 'Arrival', year: 2016 };

beforeEach(() => {
	db = createDb(':memory:').db;
	applyMigrations(db);
	ada = createUser(db, 'Ada').id;
	grace = createUser(db, 'Grace').id;
	groupId = createGroup(db, { name: 'Movie Club', ownerId: ada });
	addMember(db, grace, groupId);
});

describe('addSuggestion', () => {
	it('adds a film to the pool', () => {
		const result = addSuggestion(db, { groupId, userId: ada, movie: dune, settings });
		expect(result.ok).toBe(true);
		expect(listPool(db, groupId, ada, settings)).toHaveLength(1);
	});

	it('refuses a duplicate without saying who added it first', () => {
		addSuggestion(db, { groupId, userId: ada, movie: dune, settings });
		const result = addSuggestion(db, { groupId, userId: grace, movie: dune, settings });
		expect(result).toEqual({ ok: false, reason: 'duplicate' });
		expect(JSON.stringify(result)).not.toContain(ada);
	});

	it('treats the same film typed by hand as a duplicate of itself', () => {
		addSuggestion(db, { groupId, userId: ada, movie: { title: 'Amélie', year: 2001 }, settings });
		const result = addSuggestion(db, {
			groupId,
			userId: grace,
			movie: { title: 'amelie', year: 2001 },
			settings
		});
		expect(result).toEqual({ ok: false, reason: 'duplicate' });
	});

	it('lets a different group hold the same film', () => {
		const other = createGroup(db, { name: 'Other', ownerId: grace });
		addSuggestion(db, { groupId, userId: ada, movie: dune, settings });
		expect(addSuggestion(db, { groupId: other, userId: grace, movie: dune, settings }).ok).toBe(
			true
		);
	});

	it('refuses once the member is at their cap', () => {
		const capped = { ...settings, maxOpenSuggestions: 1 };
		addSuggestion(db, { groupId, userId: ada, movie: dune, settings: capped });
		expect(addSuggestion(db, { groupId, userId: ada, movie: arrival, settings: capped })).toEqual({
			ok: false,
			reason: 'cap_reached'
		});
	});

	it('counts the cap per member, not per group', () => {
		const capped = { ...settings, maxOpenSuggestions: 1 };
		addSuggestion(db, { groupId, userId: ada, movie: dune, settings: capped });
		expect(addSuggestion(db, { groupId, userId: grace, movie: arrival, settings: capped }).ok).toBe(
			true
		);
	});

	it('frees a slot when a suggestion is withdrawn', () => {
		const capped = { ...settings, maxOpenSuggestions: 1 };
		const first = addSuggestion(db, { groupId, userId: ada, movie: dune, settings: capped });
		withdrawSuggestion(db, ada, (first as { suggestionId: string }).suggestionId);
		expect(addSuggestion(db, { groupId, userId: ada, movie: arrival, settings: capped }).ok).toBe(
			true
		);
	});

	it('rejects an empty title rather than storing a blank film', () => {
		expect(addSuggestion(db, { groupId, userId: ada, movie: { title: '  ' }, settings })).toEqual({
			ok: false,
			reason: 'bad_title'
		});
	});

	it('truncates an over-long note rather than refusing the film', () => {
		const note = 'x'.repeat(500);
		const result = addSuggestion(db, { groupId, userId: ada, movie: dune, note, settings });
		const row = db.select().from(suggestions).get();
		expect(result.ok).toBe(true);
		expect(row?.note).toHaveLength(200);
	});
});

describe('withdrawSuggestion', () => {
	it('withdraws your own open suggestion', () => {
		const added = addSuggestion(db, { groupId, userId: ada, movie: dune, settings });
		const id = (added as { suggestionId: string }).suggestionId;
		expect(withdrawSuggestion(db, ada, id)).toBe('ok');
		expect(listPool(db, groupId, ada, settings)).toHaveLength(0);
	});

	it("refuses to withdraw someone else's suggestion", () => {
		const added = addSuggestion(db, { groupId, userId: ada, movie: dune, settings });
		const id = (added as { suggestionId: string }).suggestionId;
		expect(withdrawSuggestion(db, grace, id)).toBe('not_found');
		expect(listPool(db, groupId, ada, settings)).toHaveLength(1);
	});

	it('refuses to withdraw a film that has already been drawn', () => {
		const added = addSuggestion(db, { groupId, userId: ada, movie: dune, settings });
		const id = (added as { suggestionId: string }).suggestionId;
		db.update(suggestions).set({ status: 'drawn' }).where(eq(suggestions.id, id)).run();
		expect(withdrawSuggestion(db, ada, id)).toBe('already_drawn');
	});
});

describe('listPool', () => {
	it('marks only your own suggestions as yours', () => {
		addSuggestion(db, { groupId, userId: ada, movie: dune, settings });
		addSuggestion(db, { groupId, userId: grace, movie: arrival, settings });
		const asAda = listPool(db, groupId, ada, settings);
		expect(asAda.filter((entry) => entry.mine).map((entry) => entry.title)).toEqual(['Dune']);
	});

	it("never carries another member's identity in the payload", () => {
		addSuggestion(db, { groupId, userId: grace, movie: arrival, settings });
		const asAda = listPool(db, groupId, ada, settings);
		expect(JSON.stringify(asAda)).not.toContain(grace);
		expect(Object.keys(asAda[0])).not.toContain('suggestedBy');
	});

	it('hides withdrawn suggestions from everyone', () => {
		const added = addSuggestion(db, { groupId, userId: ada, movie: dune, settings });
		withdrawSuggestion(db, ada, (added as { suggestionId: string }).suggestionId);
		expect(listPool(db, groupId, grace, settings)).toHaveLength(0);
	});

	it('drops a drawn film from the pool by default', () => {
		const added = addSuggestion(db, { groupId, userId: ada, movie: dune, settings });
		const id = (added as { suggestionId: string }).suggestionId;
		db.update(suggestions).set({ status: 'drawn' }).where(eq(suggestions.id, id)).run();
		expect(listPool(db, groupId, ada, settings)).toHaveLength(0);
	});

	it('keeps a drawn film in the pool when the group allows repeats', () => {
		const repeats = { ...settings, repeatDrawnFilms: true };
		const added = addSuggestion(db, { groupId, userId: ada, movie: dune, settings: repeats });
		const id = (added as { suggestionId: string }).suggestionId;
		db.update(suggestions).set({ status: 'drawn' }).where(eq(suggestions.id, id)).run();
		expect(listPool(db, groupId, ada, repeats)).toHaveLength(1);
	});
});

describe('countOpenSuggestions', () => {
	it("counts only this member's open suggestions in this group", () => {
		addSuggestion(db, { groupId, userId: ada, movie: dune, settings });
		addSuggestion(db, { groupId, userId: grace, movie: arrival, settings });
		expect(countOpenSuggestions(db, groupId, ada)).toBe(1);
	});
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/lib/server/suggestions.test.ts`
Expected: FAIL — cannot resolve `./suggestions`.

- [ ] **Step 3: Write the movie cache**

`src/lib/server/movies.ts`:

```ts
import { eq } from 'drizzle-orm';
import type { DB } from './db/client';
import { movies } from './db/schema';

export type MovieInput = {
	tmdbId?: number | null;
	title: string;
	year?: number | null;
	posterUrl?: string | null;
	runtime?: number | null;
	genres?: string[] | null;
	tmdbRating?: number | null;
};

/**
 * The `movies` table is a cache, not a catalogue: metadata is fetched from TMDB
 * once and read from SQLite forever after, so a detail view works with no API
 * key and the instance does not phone out on every page load (PRD §5).
 *
 * One row per `tmdb_id`, shared across groups. A hand-entered film has no id,
 * so it gets its own row — two groups typing the same film by hand hold two
 * rows, which is correct: PRD §10 scopes the uniqueness rule to `tmdb_id`, and
 * per-group duplicate protection is the suggestion's `dedupe_key`, not this.
 */
export function findOrCreateMovie(db: DB, input: MovieInput): string {
	if (input.tmdbId != null) {
		const existing = db
			.select({ id: movies.id })
			.from(movies)
			.where(eq(movies.tmdbId, input.tmdbId))
			.get();
		if (existing) return existing.id;
	}
	const id = crypto.randomUUID();
	db.insert(movies)
		.values({
			id,
			tmdbId: input.tmdbId ?? null,
			title: input.title,
			year: input.year ?? null,
			posterUrl: input.posterUrl ?? null,
			runtime: input.runtime ?? null,
			genres: input.genres ?? null,
			tmdbRating: input.tmdbRating ?? null,
			cachedAt: new Date()
		})
		.run();
	return id;
}
```

- [ ] **Step 4: Write the pool commands**

`src/lib/server/suggestions.ts`:

```ts
import { and, eq, isNull, ne, or } from 'drizzle-orm';
import type { DB } from './db/client';
import { movies, suggestions, type GroupSettings } from './db/schema';
import { dedupeKey } from './dedupe';
import { findOrCreateMovie, type MovieInput } from './movies';

export const NOTE_MAX = 200;

export type AddResult =
	| { ok: true; suggestionId: string }
	| { ok: false; reason: 'duplicate' | 'cap_reached' | 'bad_title' };

/**
 * What a member may see about a film before the draw. There is deliberately no
 * author field: `mine` is the only thing said about ownership, so no route or
 * component can leak who suggested what. PRD §5 reveals that with the draw.
 */
export type PoolEntry = {
	suggestionId: string;
	title: string;
	year: number | null;
	posterUrl: string | null;
	runtime: number | null;
	mine: boolean;
	status: 'open' | 'drawn';
};

export function countOpenSuggestions(db: DB, groupId: string, userId: string): number {
	return db
		.select({ id: suggestions.id })
		.from(suggestions)
		.where(
			and(
				eq(suggestions.groupId, groupId),
				eq(suggestions.suggestedBy, userId),
				eq(suggestions.status, 'open')
			)
		)
		.all().length;
}

export function addSuggestion(
	db: DB,
	input: {
		groupId: string;
		userId: string;
		movie: MovieInput;
		note?: string | null;
		settings: GroupSettings;
	}
): AddResult {
	const title = input.movie.title.trim();
	if (!title) return { ok: false, reason: 'bad_title' };

	const key = dedupeKey({ ...input.movie, title });
	// An over-long note is trimmed rather than rejected: losing the film because
	// someone was chatty is a worse outcome than a clipped sentence.
	const note = input.note?.trim().slice(0, NOTE_MAX) || null;

	// The cap check and the insert must be one step. Checking before an `await`
	// in a route would let two tabs both pass a cap of 3 at 3 suggestions.
	return db.transaction(() => {
		if (countOpenSuggestions(db, input.groupId, input.userId) >= input.settings.maxOpenSuggestions) {
			return { ok: false, reason: 'cap_reached' } as const;
		}
		const clash = db
			.select({ id: suggestions.id })
			.from(suggestions)
			.where(and(eq(suggestions.groupId, input.groupId), eq(suggestions.dedupeKey, key)))
			.get();
		// Deliberately does not say who: PRD §5 rejects duplicates without
		// revealing who added the film first.
		if (clash) return { ok: false, reason: 'duplicate' } as const;

		const movieId = findOrCreateMovie(db, { ...input.movie, title });
		const suggestionId = crypto.randomUUID();
		db.insert(suggestions)
			.values({
				id: suggestionId,
				groupId: input.groupId,
				movieId,
				suggestedBy: input.userId,
				dedupeKey: key,
				note
			})
			.run();
		return { ok: true, suggestionId } as const;
	});
}

export function withdrawSuggestion(
	db: DB,
	userId: string,
	suggestionId: string
): 'ok' | 'not_found' | 'already_drawn' {
	return db.transaction(() => {
		const row = db
			.select({ status: suggestions.status, suggestedBy: suggestions.suggestedBy })
			.from(suggestions)
			.where(eq(suggestions.id, suggestionId))
			.get();
		// Someone else's suggestion is "not found", not "forbidden" — the pool is
		// anonymous, so confirming it exists would say more than it should.
		if (!row || row.suggestedBy !== userId) return 'not_found' as const;
		if (row.status !== 'open') return 'already_drawn' as const;
		db.update(suggestions)
			.set({ status: 'withdrawn' })
			.where(eq(suggestions.id, suggestionId))
			.run();
		return 'ok' as const;
	});
}

export function listPool(
	db: DB,
	groupId: string,
	viewerId: string,
	settings: GroupSettings
): PoolEntry[] {
	const visible = settings.repeatDrawnFilms
		? or(eq(suggestions.status, 'open'), eq(suggestions.status, 'drawn'))
		: eq(suggestions.status, 'open');

	return db
		.select({
			suggestionId: suggestions.id,
			suggestedBy: suggestions.suggestedBy,
			status: suggestions.status,
			title: movies.title,
			year: movies.year,
			posterUrl: movies.posterUrl,
			runtime: movies.runtime
		})
		.from(suggestions)
		.innerJoin(movies, eq(movies.id, suggestions.movieId))
		.where(and(eq(suggestions.groupId, groupId), visible))
		.all()
		.map((row) => ({
			suggestionId: row.suggestionId,
			title: row.title,
			year: row.year,
			posterUrl: row.posterUrl,
			runtime: row.runtime,
			mine: row.suggestedBy === viewerId,
			status: row.status as 'open' | 'drawn'
		}));
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run src/lib/server/suggestions.test.ts`
Expected: PASS, 18 tests.

- [ ] **Step 6: Commit**

```bash
git add src/lib/server/movies.ts src/lib/server/suggestions.ts src/lib/server/suggestions.test.ts
git commit -m "feat(pool): movie cache, anonymous pool listing, cap and dedupe"
```

---

## Task 5: The pool view

**Files:**
- Modify: `src/routes/groups/[groupId]/+page.server.ts`, `src/routes/groups/[groupId]/+page.svelte`, `src/lib/i18n/en.json`, `src/lib/i18n/de.json`

**Interfaces:**
- Consumes: `requireUser`, `requireMember` (Task 1); `listPool`, `withdrawSuggestion`, `countOpenSuggestions` (Task 4).
- Produces: the group page rendering an anonymous poster grid, with withdraw on your own films.

PRD §5: a grid of posters with no indication of who submitted them; only your own are marked as yours; no voting, no likes, no comments — that would undermine the whole idea of the random pick.

- [ ] **Step 1: Add the translation keys**

To `src/lib/i18n/en.json`:

```json
	"pool.title": "The pool",
	"pool.empty": "No films yet. Add the first one.",
	"pool.yours": "Yours",
	"pool.add": "Add a film",
	"pool.withdraw": "Withdraw",
	"pool.count": "{used} of {max} suggestions used",
	"pool.no_poster": "No poster",
	"pool.drawn": "Already watched",
	"pool.error.duplicate": "That film is already in the pool.",
	"pool.error.cap_reached": "You have used all your suggestions. Withdraw one first.",
	"pool.error.bad_title": "Please enter a film title.",
	"pool.error.not_found": "That suggestion is not yours, or no longer exists.",
	"pool.error.already_drawn": "That film has already been drawn and cannot be withdrawn."
```

To `src/lib/i18n/de.json`:

```json
	"pool.title": "Der Pool",
	"pool.empty": "Noch keine Filme. Füg den ersten hinzu.",
	"pool.yours": "Von dir",
	"pool.add": "Film hinzufügen",
	"pool.withdraw": "Zurückziehen",
	"pool.count": "{used} von {max} Vorschlägen genutzt",
	"pool.no_poster": "Kein Poster",
	"pool.drawn": "Schon gesehen",
	"pool.error.duplicate": "Dieser Film ist schon im Pool.",
	"pool.error.cap_reached": "Du hast alle deine Vorschläge genutzt. Zieh zuerst einen zurück.",
	"pool.error.bad_title": "Bitte gib einen Filmtitel ein.",
	"pool.error.not_found": "Dieser Vorschlag ist nicht von dir oder existiert nicht mehr.",
	"pool.error.already_drawn": "Dieser Film wurde schon gezogen und kann nicht zurückgezogen werden."
```

- [ ] **Step 2: Load the pool**

Rewrite `src/routes/groups/[groupId]/+page.server.ts`'s `load`, and add the `withdraw` action alongside the existing `invite` one. The file already imports `db`, `listMembers`, `requireMember`, `createInvite`, `rateLimit` and `fail`; add `requireUser` to the `groups` import and `countOpenSuggestions`, `listPool`, `withdrawSuggestion` from `$lib/server/suggestions`:

```ts
export const load: PageServerLoad = ({ locals, params }) => {
	const user = requireUser(locals);
	const group = requireMember(db, user.id, params.groupId);
	return {
		group,
		members: listMembers(db, params.groupId),
		pool: listPool(db, params.groupId, user.id, group.settings),
		used: countOpenSuggestions(db, params.groupId, user.id),
		max: group.settings.maxOpenSuggestions
	};
};
```

```ts
	withdraw: async ({ request, locals, params }) => {
		const user = requireUser(locals);
		// Membership is checked before anything is read or written, even though
		// withdrawSuggestion is itself owner-scoped — a non-member must not learn
		// the group exists.
		requireMember(db, user.id, params.groupId);
		const form = await request.formData();
		const outcome = withdrawSuggestion(db, user.id, String(form.get('suggestionId') ?? ''));
		if (outcome !== 'ok') return fail(400, { error: `pool.error.${outcome}` });
		return { withdrawn: true };
	}
```

- [ ] **Step 3: Render the grid**

Add to `src/routes/groups/[groupId]/+page.svelte`, above the member list:

```svelte
<section class="mb-8">
	<div class="mb-3 flex flex-wrap items-center gap-3">
		<h2 class="text-lg font-semibold">{t(data.locale, 'pool.title')}</h2>
		<span class="text-sm opacity-70">
			{t(data.locale, 'pool.count', { used: data.used, max: data.max })}
		</span>
		<a class="btn btn-primary btn-sm min-h-11" href="/groups/{data.group.groupId}/add">
			{t(data.locale, 'pool.add')}
		</a>
	</div>

	{#if form?.error}
		<div class="alert alert-error mb-3" role="alert">{t(data.locale, form.error)}</div>
	{/if}

	{#if data.pool.length === 0}
		<p>{t(data.locale, 'pool.empty')}</p>
	{:else}
		<ul class="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4">
			{#each data.pool as entry (entry.suggestionId)}
				<li class="card bg-base-100 shadow-sm">
					{#if entry.posterUrl}
						<img
							class="aspect-[2/3] w-full rounded-t-box object-cover"
							src={entry.posterUrl}
							alt={entry.title}
							loading="lazy"
						/>
					{:else}
						<div
							class="bg-base-300 flex aspect-[2/3] w-full items-center justify-center rounded-t-box p-2 text-center text-sm"
						>
							{t(data.locale, 'pool.no_poster')}
						</div>
					{/if}
					<div class="card-body gap-1 p-3">
						<p class="font-medium">{entry.title}</p>
						<p class="text-sm opacity-70">
							{entry.year ?? ''}{entry.runtime ? ` · ${entry.runtime} min` : ''}
						</p>
						{#if entry.status === 'drawn'}
							<span class="badge badge-sm">{t(data.locale, 'pool.drawn')}</span>
						{/if}
						{#if entry.mine}
							<span class="badge badge-primary badge-sm">{t(data.locale, 'pool.yours')}</span>
							{#if entry.status === 'open'}
								<form method="POST" action="?/withdraw">
									<input type="hidden" name="suggestionId" value={entry.suggestionId} />
									<button class="btn btn-ghost btn-sm mt-1 min-h-11 w-full">
										{t(data.locale, 'pool.withdraw')}
									</button>
								</form>
							{/if}
						{/if}
					</div>
				</li>
			{/each}
		</ul>
	{/if}
</section>
```

Note the poster `alt` is the film title, not "poster" — a screen reader user needs the film, not the word.

- [ ] **Step 4: Verify and commit**

Run: `npm run lint && npm run check && npm test && npm run build`
Then by hand from a fresh `rm -rf data`: complete setup, create a group, confirm the pool section renders empty with the count showing `0 of 3`, and that the "Add a film" link points at `/groups/<id>/add` (404 until Task 6 — expected).

```bash
git add -A
git commit -m "feat(pool): anonymous poster grid on the group page"
```

---

## Task 6: Add a film by hand

This path ships **before** TMDB search, deliberately: PRD §5 requires the app to be fully usable with no API key, so the keyless path is the one that must work first and must never depend on the other.

**Files:**
- Create: `src/routes/groups/[groupId]/add/+page.server.ts`, `src/routes/groups/[groupId]/add/+page.svelte`
- Modify: `src/lib/i18n/en.json`, `src/lib/i18n/de.json`

**Interfaces:**
- Consumes: `requireUser`, `requireMember`; `addSuggestion`, `NOTE_MAX`.
- Produces: a working add-by-hand form.

- [ ] **Step 1: Add the translation keys**

To `src/lib/i18n/en.json`:

```json
	"add.title": "Add a film to {group}",
	"add.manual_heading": "Type it in",
	"add.film_title": "Title",
	"add.year": "Year (optional)",
	"add.poster": "Poster URL (optional)",
	"add.note": "Why this film? (optional)",
	"add.note_hint": "Shown to the group only after the draw, max 200 characters.",
	"add.submit": "Add to the pool",
	"add.back": "Back to the group"
```

To `src/lib/i18n/de.json`:

```json
	"add.title": "Film zu {group} hinzufügen",
	"add.manual_heading": "Selbst eintragen",
	"add.film_title": "Titel",
	"add.year": "Jahr (optional)",
	"add.poster": "Poster-URL (optional)",
	"add.note": "Warum dieser Film? (optional)",
	"add.note_hint": "Wird der Gruppe erst nach der Ziehung gezeigt, höchstens 200 Zeichen.",
	"add.submit": "Zum Pool hinzufügen",
	"add.back": "Zurück zur Gruppe"
```

- [ ] **Step 2: Write the route**

`src/routes/groups/[groupId]/add/+page.server.ts`:

```ts
import { db } from '$lib/server/db';
import { requireMember, requireUser } from '$lib/server/groups';
import { addSuggestion, NOTE_MAX } from '$lib/server/suggestions';
import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = ({ locals, params }) => {
	const user = requireUser(locals);
	const group = requireMember(db, user.id, params.groupId);
	return { group, noteMax: NOTE_MAX };
};

export const actions: Actions = {
	manual: async ({ request, locals, params }) => {
		const user = requireUser(locals);
		const group = requireMember(db, user.id, params.groupId);

		const form = await request.formData();
		// Everything below this line is synchronous, so the cap check inside
		// addSuggestion cannot be raced by a second tab.
		const rawYear = String(form.get('year') ?? '').trim();
		const year = /^\d{4}$/.test(rawYear) ? Number(rawYear) : null;
		const posterUrl = String(form.get('posterUrl') ?? '').trim() || null;

		const result = addSuggestion(db, {
			groupId: params.groupId,
			userId: user.id,
			movie: { title: String(form.get('title') ?? ''), year, posterUrl },
			note: String(form.get('note') ?? ''),
			settings: group.settings
		});
		if (!result.ok) return fail(400, { error: `pool.error.${result.reason}` });
		redirect(303, `/groups/${params.groupId}`);
	}
};
```

`src/routes/groups/[groupId]/add/+page.svelte`:

```svelte
<script lang="ts">
	import { t } from '$lib/i18n';
	let { data, form } = $props();
</script>

<h1 class="mb-4 text-2xl font-bold">
	{t(data.locale, 'add.title', { group: data.group.name })}
</h1>

{#if form?.error}
	<div class="alert alert-error mb-4" role="alert">{t(data.locale, form.error)}</div>
{/if}

<h2 class="mb-2 text-lg font-semibold">{t(data.locale, 'add.manual_heading')}</h2>
<form method="POST" action="?/manual" class="mb-6 flex max-w-md flex-col gap-3">
	<label class="form-control">
		<span class="label-text">{t(data.locale, 'add.film_title')}</span>
		<input name="title" required maxlength="200" class="input input-bordered min-h-11" />
	</label>
	<label class="form-control">
		<span class="label-text">{t(data.locale, 'add.year')}</span>
		<input name="year" inputmode="numeric" maxlength="4" class="input input-bordered min-h-11" />
	</label>
	<label class="form-control">
		<span class="label-text">{t(data.locale, 'add.poster')}</span>
		<input name="posterUrl" type="url" class="input input-bordered min-h-11" />
	</label>
	<label class="form-control">
		<span class="label-text">{t(data.locale, 'add.note')}</span>
		<textarea name="note" maxlength={data.noteMax} rows="2" class="textarea textarea-bordered"
		></textarea>
		<span class="label-text-alt">{t(data.locale, 'add.note_hint')}</span>
	</label>
	<button class="btn btn-primary min-h-11">{t(data.locale, 'add.submit')}</button>
</form>

<a class="btn btn-ghost min-h-11" href="/groups/{data.group.groupId}">
	{t(data.locale, 'add.back')}
</a>
```

- [ ] **Step 3: Verify by hand and commit**

Run: `npm run lint && npm run check && npm test && npm run build`, then `rm -rf data && npm run dev`.

Walk it: setup, create a group, add a film by hand with a title and year, confirm it appears in the pool with a "No poster" placeholder and a "Yours" badge. Add two more, then a fourth — confirm the cap message. Withdraw one, confirm the fourth now succeeds. Add the same title again in different case — confirm the duplicate message. Then open the group in a private window as a second member and confirm **none of the films show a "Yours" badge and no member name appears anywhere in the page source**.

```bash
git add -A
git commit -m "feat(pool): add a film by hand, no API key required"
```

---

## Task 7: Add a film through TMDB search

**Files:**
- Modify: `src/routes/groups/[groupId]/add/+page.server.ts`, `src/routes/groups/[groupId]/add/+page.svelte`, `src/lib/i18n/en.json`, `src/lib/i18n/de.json`

**Interfaces:**
- Consumes: `searchMovies`, `fetchMovie` (Task 3); `addSuggestion` (Task 4).
- Produces: a search box that adopts a film with one click, and degrades to manual entry when no key is configured or TMDB is unreachable.

- [ ] **Step 1: Add the translation keys**

To `src/lib/i18n/en.json`:

```json
	"add.search_heading": "Search",
	"add.search_placeholder": "Film title",
	"add.search_submit": "Search",
	"add.search_none": "Nothing found. Type it in below instead.",
	"add.search_disabled": "Search is off because this instance has no TMDB API key. You can still add films by hand.",
	"add.search_failed": "Search is unavailable right now. You can still add films by hand.",
	"add.adopt": "Add this one"
```

To `src/lib/i18n/de.json`:

```json
	"add.search_heading": "Suchen",
	"add.search_placeholder": "Filmtitel",
	"add.search_submit": "Suchen",
	"add.search_none": "Nichts gefunden. Trag den Film unten selbst ein.",
	"add.search_disabled": "Die Suche ist aus, weil diese Instanz keinen TMDB-API-Key hat. Du kannst Filme trotzdem selbst eintragen.",
	"add.search_failed": "Die Suche ist gerade nicht erreichbar. Du kannst Filme trotzdem selbst eintragen.",
	"add.adopt": "Diesen hinzufügen"
```

- [ ] **Step 2: Extend the route**

In `+page.server.ts`, read the key from env — this route is the boundary where a secret enters, and it passes it as a parameter so `tmdb.ts` stays env-free:

```ts
import { env } from '$env/dynamic/private';
import { fetchMovie, searchMovies } from '$lib/server/tmdb';
```

Add `tmdbEnabled: !!env.TMDB_API_KEY` to the `load` return, and two actions:

```ts
	search: async ({ request, locals, params }) => {
		const user = requireUser(locals);
		requireMember(db, user.id, params.groupId);
		const key = env.TMDB_API_KEY;
		if (!key) return fail(400, { error: 'add.search_disabled' });

		const query = String((await request.formData()).get('query') ?? '').trim();
		if (!query) return { results: [], query };
		try {
			return { results: await searchMovies(key, query), query };
		} catch {
			// TMDB being down must never block the mandated manual path.
			return fail(502, { error: 'add.search_failed' });
		}
	},

	adopt: async ({ request, locals, params }) => {
		const user = requireUser(locals);
		const group = requireMember(db, user.id, params.groupId);
		const key = env.TMDB_API_KEY;
		if (!key) return fail(400, { error: 'add.search_disabled' });

		const form = await request.formData();
		const tmdbId = Number(form.get('tmdbId'));
		if (!Number.isInteger(tmdbId)) return fail(400, { error: 'pool.error.bad_title' });

		let detail;
		try {
			detail = await fetchMovie(key, tmdbId);
		} catch {
			return fail(502, { error: 'add.search_failed' });
		}
		if (!detail) return fail(404, { error: 'add.search_none' });

		// Past the last await: the cap check inside addSuggestion is now unraceable.
		const result = addSuggestion(db, {
			groupId: params.groupId,
			userId: user.id,
			movie: detail,
			note: String(form.get('note') ?? ''),
			settings: group.settings
		});
		if (!result.ok) return fail(400, { error: `pool.error.${result.reason}` });
		redirect(303, `/groups/${params.groupId}`);
	}
```

- [ ] **Step 3: Render the search half**

Add above the manual form in `+page.svelte`:

```svelte
<h2 class="mb-2 text-lg font-semibold">{t(data.locale, 'add.search_heading')}</h2>

{#if !data.tmdbEnabled}
	<div class="alert mb-4" role="status">{t(data.locale, 'add.search_disabled')}</div>
{:else}
	<form method="POST" action="?/search" class="mb-4 flex max-w-md gap-2">
		<input
			name="query"
			required
			placeholder={t(data.locale, 'add.search_placeholder')}
			aria-label={t(data.locale, 'add.search_placeholder')}
			class="input input-bordered min-h-11 flex-1"
		/>
		<button class="btn btn-primary min-h-11">{t(data.locale, 'add.search_submit')}</button>
	</form>

	{#if form?.results}
		{#if form.results.length === 0}
			<p class="mb-4">{t(data.locale, 'add.search_none')}</p>
		{:else}
			<ul class="mb-6 grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4">
				{#each form.results as result (result.tmdbId)}
					<li class="card bg-base-100 shadow-sm">
						{#if result.posterUrl}
							<img
								class="aspect-[2/3] w-full rounded-t-box object-cover"
								src={result.posterUrl}
								alt={result.title}
								loading="lazy"
							/>
						{:else}
							<div
								class="bg-base-300 flex aspect-[2/3] w-full items-center justify-center rounded-t-box p-2 text-center text-sm"
							>
								{t(data.locale, 'pool.no_poster')}
							</div>
						{/if}
						<div class="card-body gap-1 p-3">
							<p class="font-medium">{result.title}</p>
							<p class="text-sm opacity-70">{result.year ?? ''}</p>
							<form method="POST" action="?/adopt">
								<input type="hidden" name="tmdbId" value={result.tmdbId} />
								<button class="btn btn-secondary btn-sm mt-1 min-h-11 w-full">
									{t(data.locale, 'add.adopt')}
								</button>
							</form>
						</div>
					</li>
				{/each}
			</ul>
		{/if}
	{/if}
{/if}
```

- [ ] **Step 4: Verify both paths and commit**

Run the full gates, then verify **with no key configured**: the search section shows the disabled notice and the manual form still works end to end. That is the mandated path and it must be checked first.

Then, **if a `TMDB_API_KEY` is available**, put it in `.env`, restart, search for a film, adopt it, and confirm the poster, year and runtime all appear in the pool. Confirm the same film cannot be adopted twice. If no key is available, say so in the report — do not fake it.

```bash
git add -A
git commit -m "feat(pool): TMDB search with graceful degradation to manual entry"
```

---

## Self-review

**Spec coverage.** PRD §5: live TMDB search with poster and year (Task 7), manual fallback (Task 6), `tmdb_id` adoption and local metadata caching (Tasks 3–4), the `dedupe_key` in both forms (Task 2), duplicates refused without revealing who added first (Task 4), withdraw while undrawn (Task 4), the optional 200-character note stored but not shown before the draw (Task 4), drawn films leaving the pool configurably (Task 4), the anonymous poster grid with only your own marked (Tasks 4–5), and no voting or comments anywhere. §4's `maxOpenSuggestions` cap is enforced in Task 4. §10 needs no migration.

**Deliberately not here:** the wildcard pick (v1.0, and it needs the draw), revealing the suggester and the note (that happens with the draw, Plan 3), and director in search results (deviation 1 — the schema has no column for it).

**Open risk to watch.** `listPool` returns every entry for a group with no pagination. At PRD's scale — 12 members, 3 suggestions each — that is at most a few dozen rows and an index would be premature. If a group ever turns off `repeatDrawnFilms` and accumulates years of drawn films, revisit: the query is already filtered on `status`, so the fix is an index on `suggestions(group_id, status)`, which Plan 3 will want anyway.

## Plan sequence

| Plan | Delivers | Depends on |
| --- | --- | --- |
| 1. Foundation & access | Instance setup, groups, invites, login links, i18n, schema, migrations | — |
| **2. Movie pool** (this one) | TMDB search, manual entry, dedupe, anonymous pool grid, withdraw, per-member cap | 1 |
| 3. Nights & the draw | Scheduling, RSVP, the four states, fairness-weighted draw, seeded append-only log, 1000-night simulation | 1, 2 |
| 4. Ratings | Window arithmetic, blind submission, reveal, average and spread | 1, 3 |
| 5. Ship it | Multi-arch Docker on a glibc base, compose, CI, README/LICENSE, backup command, PWA polish, a11y pass | 1–4 |
