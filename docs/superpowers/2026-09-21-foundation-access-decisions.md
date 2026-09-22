# filmnacht Plan 1 — decision log

Every ruling taken while executing `docs/superpowers/plans/2026-09-21-foundation-access.md`,
with what it costs if it turns out wrong. Preserved from the execution ledger.

Branch: `plan/01-foundation-access` (`dd21699..34d9197`, 30 commits, 86 tests)

# SDD ledger — plan: docs/superpowers/plans/2026-09-21-foundation-access.md

Spec: prd.md (read — sections 3, 4, 9, 10, 11, 12 bind this plan)
Branch: plan/01-foundation-access (merge-base: dd21699 on main)

## Setup rulings

Ruling: feature branch, not a git worktree — the repo was created empty in this
session, nothing else is in flight, and the user wants the project to live at
/home/xfuture/code/filmnacht rather than in a sibling worktree directory.
Cost if wrong: none material; a worktree can be added later without moving work.

Ruling: `git init` + the initial commit (dd21699, PRD + plan) were done by the
controller during setup, so Task 1 Step 1's `git init` is already satisfied.
Task 1's implementer is told to skip it and to MERGE into the existing
.gitignore rather than let `sv create` clobber it.
Cost if wrong: a clobbered .gitignore, recoverable from dd21699.

## Pre-flight conflict scan

### Cross-task rows (tasks sharing a file or an interface)

| Tasks | Produced → consumed | Finding |
| --- | --- | --- |
| 1 → all | `vite.config.ts` `test.include: src/**/*.test.ts` | Clean — every test file in tasks 2-10 matches the glob |
| 1 → 2 | `tsconfig.json` `resolveJsonModule` | Clean — T2 Step 4 explicitly verifies/adds it |
| 1 → 6 | `%lang%` placeholder in `app.html` | Clean — T1 S5 writes it, T6 `transformPageChunk` replaces it |
| 2 → 6 | `resolveLocale(acceptLanguage, cookie)` | Clean — hook call site matches the 2-arg signature |
| 2 → 6,7,8,9,10 | `t(locale, key, params)` | Clean — every call site passes `data.locale` from layout data |
| 3 → 4 | `createDb`, `applyMigrations`, `MIGRATIONS_FOLDER`, `DB` | **Finding (fixed pre-dispatch)** — see ruling A below |
| 3 → 4 | `Database.Database` type used in T4, value-imported in T3 | Watch — `import Database from 'better-sqlite3'` exposes both; if TS objects, add `import type Database from 'better-sqlite3'` |
| 3 → 5 | `users`, `sessions` (`sessions.id` = token hash) | Clean |
| 3 → 5,9 | `{ mode: 'timestamp' }` stores **whole seconds**, not ms | Watch — every asserted timestamp in T5/T9 is a whole-second value, so round-trips exactly. Plans 3-4 do real date arithmetic: revisit there |
| 3 → 8 | `groups.settings` `$defaultFn` → `DEFAULT_GROUP_SETTINGS` | Clean — T8 asserts the round-trip |
| 3 → 8 | `memberships_user_group` unique → `onConflictDoUpdate` target | Clean — target columns match the constraint |
| 3 → 9 | `invites.tokenHash` PK, `uses` default 0, `maxUses` nullable | Clean |
| 5 → 6 | `SESSION_COOKIE`, `validateSession` → `{user, expiresAt, refreshed}`, `setSessionCookie(cookies, token, expiresAt, secure)` | Clean — hook destructures exactly these |
| 5 → 7 | `SessionUser` imported by `users.ts` from `auth/session.ts` | Clean — no import cycle (users → session → db/client, tokens) |
| 5 → 9,10 | `rateLimit(key, limit, windowMs)` | Clean — distinct key prefixes `join:` / `login:` |
| 6 → 7,8,9,10 | `App.Locals`, layout data `{locale, user, pathname}` | Clean — `data.user?.displayName` on the profile page resolves through layout data |
| 6 → 7 | `isSetupComplete` guard in hook vs. re-check in setup action | Clean — deliberate defence in depth, not a contradiction |
| 7 → 8 | `validateDisplayName` reused to validate a **group name** | Intentional — same rule (trimmed, 1-60), different error key. Noted in the plan's code comment |
| 7 → 9,10 | `createUser`, `regenerateLoginToken`, `userByLoginToken` | Clean |
| 8 → 9 | `+page.server.ts` for `[groupId]`: T8 writes `load`, T9 adds `actions` | Clean after the Task 9 Step 6 rewrite (no duplicated imports) |
| 8 → 9 | `addMember` vs. T9's inlined membership upsert inside its transaction | Clean — T9 inlines deliberately; Drizzle's better-sqlite3 `tx` is not assignable to `DB` |
| 7 → 10 | T10 appends tests to `users.test.ts` | Clean — `db`, helpers all in scope from that file's `beforeEach` |

### Per-task self-consistency rows

| Task | Its tests vs. its code, its files vs. later edits | Finding |
| --- | --- | --- |
| 1 | No test file exists yet | **Finding (fixed pre-dispatch)** — `vitest run` exits 1 on no matches; Step 8 now runs lint/check/build only |
| 2 | 9 assertions ↔ `t`/`resolveLocale`; `test.only_in_english` present in en.json and absent from de.json as the fallback test requires | Clean |
| 3 | 5 assertions ↔ schema; FK-violation test depends on `foreign_keys = ON` set in `createDb` | Clean |
| 4 | backup predicate ↔ its test | **Finding (fixed pre-dispatch)** — see ruling A |
| 5 | Slide test elapses 0.6·TTL (remaining 0.4·TTL < TTL/2 → refresh); fresh test elapses 1s | Clean; base64url of 16 bytes is 22 unpadded chars, matching the regex |
| 6 | 5 settings assertions ↔ `onConflictDoUpdate` upsert | Clean |
| 7 | 11 assertions ↔ `users.ts`; `validateDisplayName` boundary at exactly 60 | Clean |
| 8 | 8 assertions ↔ `groups.ts`; `status()` helper reads `.status` off SvelteKit's HttpError | Clean |
| 9 | 10 assertions ↔ `invites.ts`; re-redemption must not increment `uses` | Clean |
| 10 | Step 2 expects PASS, not FAIL — it verifies an invariant Task 7 already established before the routes lean on it | Intentional, called out in the step text |

### Rulings from the scan

Ruling A (Task 4, load-bearing, fixed before dispatch): `backupAndMigrate`
gated the backup on `appliedCount > 0`, which is false in exactly the scenario
the backup exists for — a database whose migration bookkeeping was lost. Its
test would have failed, and then `migrate()` would have re-run `CREATE TABLE`
against live tables and thrown. Split into `backupIfPending` (the decision,
now gated on `hasTables`) and `backupAndMigrate` (the composition); the test
now exercises the predicate directly rather than re-running a migration.
Cost if wrong: the pre-migration backup silently does not fire — the single
worst failure mode named in PRD §11 — so this had to be right before Task 4.

Scan otherwise clean. Proceeding to Task 1.

## Task log
Task 1: dispatched (sonnet, base dd21699)
Task 1: implementer DONE (commit 02a30c9, lint+check+build clean, 0 svelte-check errors/307 files)
Task 1: implementer concerns — (a) dropped now-dead @sveltejs/adapter-auto, (b) added /prd.md and /docs/ to .prettierignore rather than reformatting files outside the task. Both carried to the reviewer unjudged.
Controller: committed e3eeecc (the Task 4 plan fix from the pre-flight scan) AFTER 02a30c9 so it stays outside Task 1's review range.
Task 1: review dispatched (sonnet, dd21699..02a30c9)
Task 1: review verdict — spec ❌ (1 Important, plan-mandated), quality "Needs fixes". 4 Minor.
Task 1: minor (deferred): src/lib/assets/favicon.svg orphaned after the layout rewrite
Task 1: minor (deferred): README.md is still `sv create` boilerplate, not filmnacht's — Plan 5 replaces it
Task 1: minor (deferred): .prettierignore excludes /prd.md and /docs/ — reviewer called the reasoning defensible; kept
Ruling: folded the `.npmrc` engine-strict Minor into fix round 1 rather than deferring it — it is one line in the same file as the Important fix, and `engine-strict=true` is currently inert with no `engines` field, leaving the plan's binding "Node 24" constraint unenforced anywhere. Deliberate consequence: npm install now hard-fails below Node 24 instead of failing later against better-sqlite3's ABI-specific prebuilds. Cost if wrong: a contributor on an older Node is blocked at install with a clear message; one line to revert.
Ruling: fix-round re-review FIX_BASE will be e3eeecc, not 02a30c9 (the head the first review saw). e3eeecc is my own docs-only plan commit landed between the two; using it as the base keeps the re-review diff to exactly the fix. Cost if wrong: none — the skipped commit is a documentation change already described in this ledger.
Task 1: fix round 1 dispatched (resumed original implementer)
Task 1: fix round 1/5 (2 addressed, 0 open — devDependency floors; engines field; commits e3eeecc..caf44a4)
Task 1: complete (commits dd21699..caf44a4, review clean)
Task 2: dispatched (haiku — brief carries complete code, transcription + TDD; base caf44a4)
Task 2: implementer DONE (commit 2737c55, 9/9 vitest passing, lint+check clean, TDD RED/GREEN reported)
Task 2: review dispatched (sonnet, caf44a4..2737c55)
Task 2: review verdict — spec ✅, quality Approved, but 1 Important (plan-mandated) + 1 Minor.
Ruling: FIXING the plan-mandated Accept-Language finding rather than parking it. The brief's own resolveLocale returns the first supported tag in string order and ignores q-weights, so `en;q=0.5,de;q=0.9` resolves to English when the client asked for German (RFC 9110 §12.5.4: order is not significant, q is). The project's standing guidance is explicit that when two options cost the same, take the one correct on edge cases — this is ~6 lines either way. Blast radius is small (well-behaved browsers sort their headers, and the locale cookie wins once set), so it only bites a first visit from a client that doesn't sort. Cost if wrong: 6 lines of parsing to revert; the 4 existing resolveLocale tests pin the old behaviour and must still pass unmodified.
Ruling: folded the Minor into the same round. The test named "leaves unknown placeholders intact" passes no params, hits the `if (!params) return template` early return, and never executes the ternary it is named after — no test in the suite exercises the interpolation fallback branch at all. A test that does not reach the branch it claims to check is not thin coverage, it is an assertion about code it never ran. One extra case, same file. Cost if wrong: one redundant test.
Task 2: minor (deferred): none
Task 2: fix round 1 dispatched (resumed original implementer, haiku)
Task 2: fix round 1/5 (2 addressed, 0 open — q-value ranking; interpolation branch test; commits 2737c55..c355fb7)
Task 2: minor (deferred): index.ts q= with an EMPTY value ("en;q=") coerces Number('')===0, so it is filtered as if explicitly q=0 rather than defaulting to weight 1 like other malformed q values. Not a realistic header shape; untested; non-blocking.
Task 2: complete (commits caf44a4..c355fb7, review clean)
Controller: committed ca909c1 — propagated the corrected resolveLocale back into the plan doc so the final review does not grade working code against stale spec text.
Task 3: dispatched (sonnet — 12-table schema, drizzle-kit generate, integration concerns; base ca909c1)
Task 3: implementer DONE (commit 37ec36f, 17/17 passing, lint+check clean)
Controller verification of the generated migration (independent of the report): all 12 tables present in drizzle/0000_lazy_squirrel_girl.sql — attendance, groups, identities, invites, memberships, movie_nights, movies, ratings, sessions, settings, suggestions, users. All 7 unique indexes present — attendance_night_user, identities_provider_subject, memberships_user_group, movies_tmdb_id_unique, ratings_night_user, suggestions_group_dedupe, users_login_token_hash_unique.
Task 3: implementer deviations carried to the reviewer unjudged — (a) removed the unused `sql` import the brief's own code block contained, (b) added /drizzle/ to .prettierignore for drizzle-kit's generated JSON, citing the existing package-lock.json exclusion as precedent.
Task 3: review dispatched (sonnet, ca909c1..37ec36f)
Task 3: review verdict — spec ✅, quality Approved, 0 Critical/Important. No fix loop.
Task 3: minor (deferred): client.ts exports MIGRATIONS_FOLDER, not in the brief's interface list (harmless named constant)
Task 3: minor (deferred): tests never close better-sqlite3 handles; harmless for :memory: but worth a ponytail: note if copy-pasted into file-backed test suites later
Task 3: reviewer accepted both implementer deviations, having verified them: the removed `sql` import is genuinely unused, and without /drizzle/ in .prettierignore `prettier --check .` HARD-ERRORS on the .sql file (no parser), it is not a style nit.
Task 3: complete (commits ca909c1..37ec36f, review clean)
Task 4: dispatched (sonnet — appends to existing client.ts, $env singleton, integration concerns; base 442838d)
Task 4: implementer DONE (commit 71c4473, 21/21 passing, lint+check clean)
Controller verification: `$env` appears in exactly one file repo-wide (src/lib/server/db/index.ts:1) — the binding constraint holds. node:fs and node:path imports were merged into single statements in client.ts, not duplicated.
Task 4: implementer concern carried to the reviewer — wal_checkpoint(TRUNCATE) + copyFileSync is sound ONLY because this runs single-connection at startup before writers exist; flagged against later reuse as an on-demand backup endpoint.
Task 4: review dispatched (sonnet, 442838d..71c4473)
Task 4: review verdict — spec ✅, quality Approved, but 2 Important + 2 Minor.
Task 4: reviewer ⚠️ RESOLVED by controller — "is src/lib/server/db/index.ts ever imported at startup?" Yes: task-6-brief.md:129 has hooks.server.ts doing `import { db } from '$lib/server/db'`, so the backup-then-migrate side effect executes on boot. Not a gap; no action.
Ruling: FIXING both Importants rather than parking. (1) wal_checkpoint(TRUNCATE)'s `busy` flag was discarded, so a checkpoint that could not complete would silently yield a .bak missing the most recent commits — the one failure a backup module must never make silently. Now throws and refuses to migrate. (2) The single-connection caveat lived only in the implementer's report; folded into the code comment with the failure mode stated, so it travels with the code to whoever later wants an on-demand backup endpoint. Cost if wrong: a startup that refuses to boot when another connection holds the DB — loud and diagnosable, versus a silent torn backup.
Ruling: folded the journal() ENOENT Minor into the same round. The plan already names "drizzle/ must ship in the Docker image" as a known packaging risk, so a named error message is the cheapest mitigation of a risk already on the books, and it is 3 lines in a function already being edited. Cost if wrong: three lines of error wrapping.
Ruling: requested a 5th test exercising the busy-checkpoint branch, WITH an explicit escape hatch to drop it and report DONE_WITH_CONCERNS if it proves non-deterministic. A flaky test in a data-safety path is worse than a documented gap.
Task 4: minor (deferred): hasTables would return true for a DB holding only __drizzle_migrations; reviewer verified that state is unreachable (the table is only created inside the same migration batch as the app tables)
Task 4: fix round 1 dispatched (resumed original implementer)
Task 4: fix landed (commit 66b0d50, 22/22 passing). Implementer kept the busy-checkpoint test rather than using the drop escape hatch, diagnosing the 5s delay as createDb's own busy_timeout=5000 producing a deterministic floor (verified over 3 isolated runs), not flakiness.
Controller observation carried into the re-review as a named risk, NOT pre-judged: the suite went 270ms -> 6.29s, a ~23x slowdown, essentially all of it that one test waiting out busy_timeout. Six tasks remain, each running the suite repeatedly. Asked the re-reviewer for an explicit keep/tighten/drop recommendation, and whether lowering busy_timeout on the connection under test would report busy immediately while still exercising the same branch.
Task 4: scoped re-review dispatched (sonnet, 71c4473..66b0d50)
Task 4: fix round 1/5 (4 addressed, 0 open — checkpoint busy guard; in-code failure mode; journal() named error; busy-checkpoint test; commits 71c4473..66b0d50)
Task 4: re-review flagged NEW Important breakage in the fix diff — the ~6s suite floor is unforced. It empirically ran busy_timeout=0 against the repo's own better-sqlite3 and got the identical busy result in 0ms, and additionally found the {timeout: 8000} override leaves only ~2-3s margin over the observed 5033-6010ms range, i.e. the merged test carries the very CI flakiness we tried to avoid. Per the loop, new Important breakage joins the open findings -> round 2.
Task 4: fix round 2 dispatched (resumed original implementer) — one-line per-connection `busy_timeout = 0` in the test, drop the per-test timeout override, do NOT touch createDb's production pragma.
Task 4: fix round 2/5 (5 checks addressed, 0 open — busy_timeout=0 on the right connection, before the call, override removed, client.ts untouched, assertion still pinned; commits 66b0d50..beeded4). Suite 6.29s -> 1.02s.
Task 4: complete (commits 442838d..beeded4, review clean, 2 fix rounds)
Controller: committed d1210a8 — propagated the checkpoint-busy guard and journal() error wrapper back into the plan doc.
Task 5: dispatched (sonnet — security boundary: token entropy, hashed sessions, sliding expiry; base d1210a8)
Task 5: implementer DONE (commit 1d48e2f, 35/35 passing, suite 1.24s, lint+check clean)
Controller verification of the purity constraints: `$env` still only in src/lib/server/db/index.ts:1; no `$app/` import anywhere under src/lib; session.ts:1 imports Cookies as `import type`, so it is erased at compile time. All three hold.
Task 5: review dispatched (sonnet, d1210a8..1d48e2f) — pointed specifically at the security properties: raw token never persisted, cookie flag set, sliding-expiry boundary, clearSessionCookie path match, rateLimit off-by-one.
Task 5: review verdict — spec ✅, quality Approved, 1 Important (plan-mandated) + 2 Minor.
Ruling: FIXING the rate-limiter unbounded-map finding. The brief's prune only deletes ALREADY-EXPIRED windows, so >10k distinct STILL-LIVE keys in one window grow the map without limit. Reachable by an unauthenticated attacker: tasks 9/10 key this on getClientAddress(), and adapter-node behind a proxy that trusts X-Forwarded-For lets one machine mint unlimited distinct "client IPs". Fix is a hard cap with oldest-first eviction (Map iterates in insertion order). Evicting a live window only hands that key a fresh budget, so it cannot be used to win extra allowance. Cost if wrong: ~15 lines to revert; the existing 3 limiter tests pin the allow/refuse/reset semantics.
Ruling: folded in a Minor the reviewer raised only parenthetically — session.test.ts's cascade test asserts only that validateSession returns null, which passes whether or not the cascade fires, because the innerJoin filters orphans anyway. Same class as the Task 2 defect: a test that would still pass if the thing it is named for broke. One extra assertion on the sessions row count. Cost if wrong: one redundant assertion.
Task 5: minor (deferred): exact boundary instants untested (elapsed === TTL, === TTL/2, === resetAt); reviewer confirmed all three read correct by inspection
Task 5: minor (deferred): expired session rows accumulate until re-presented — lazy on-read cleanup is the design, no scheduler in the MVP by decision
Task 5: fix round 1 dispatched (resumed original implementer)
Task 5: fix round 1/5 (2 addressed, 0 open — bounded map with oldest-first eviction; cascade test now asserts the row is gone; commits 1d48e2f..5b68125). Suite 36 tests, 1.2s.
Task 5: implementer correctly REJECTED the controller's "expect 37 tests" arithmetic — the change was 1 new `it` plus 1 added assertion, so 36 is right. It declined to add a filler test to hit the number. Controller was wrong; implementer was right.
Task 5: minor (deferred) — IMPORTANT FOR THE FINAL REVIEW: the in-code comment at rate-limit.ts ("Evicting a live window only ever hands that key a fresh budget, so it cannot be used to win extra allowance") is OVER-OPTIMISTIC and was written by the controller. Re-reviewer's correction: eviction does grant allowance early relative to natural resetAt. Harmless under the current threat model (an attacker forging X-Forwarded-For already gets `true` every call without the eviction detour, and both real call sites are IP-keyed), but if any future caller keys this SHARED global map on a fully attacker-controlled value — e.g. per-username login-attempt limiting — cheap key churn elsewhere could force-evict a target's counter and reset brute-force protection early. Final review should correct that comment to state the condition rather than the absolute.
Ruling: NOT opening another round for that comment. The findings are addressed, both current call sites (tasks 9/10) are IP-keyed so the bypass is unreachable in this plan, and the correction is a comment edit the final review can make. Mitigation meanwhile: carry the constraint explicitly into the Task 9 and Task 10 dispatches so neither picks an attacker-controlled rate-limit key. Cost if wrong: a misleading comment survives until the final review.
Task 5: complete (commits d1210a8..5b68125, review clean, 1 fix round)
Controller: committed 328496a — propagated the bounded limiter and the tightened cascade test into the plan doc.
Task 6: dispatched (sonnet — hooks pipeline, settings module, first UI, SvelteKit integration; base 328496a)
Task 6: implementer DONE_WITH_CONCERNS (commit 79893ce, 41/41 passing, 1.31s, lint+check+build clean, manual dev check PASSED: / -> 303 /setup, /setup 404 as expected, data/filmnacht.db created by the startup migration then cleaned up)
Task 6: two implementer concerns carried to the reviewer UNJUDGED, both framed as questions rather than accepted: (a) it disabled the ESLint rule svelte/no-navigation-without-resolve PROJECT-WIDE in eslint.config.js, a file not in the brief's list, to work around /groups and /profile not existing yet — asked the reviewer whether a permanent disable is proportionate to a temporary condition that Tasks 8 and 10 resolve; (b) the setup guard blocks POST /locale before setup completes, so the language switcher is inert on the very first screen a non-English operator sees — asked whether a visible control that silently does nothing is acceptable, given Accept-Language still auto-resolves.
Controller verification: $env still confined to src/lib/server/db/index.ts:1.
Task 6: review dispatched (sonnet, 328496a..79893ce) — also pointed at the open-redirect guard specifically re protocol-relative URLs (//evil.example starts with "/" too).
Task 6: review verdict — spec ❌, quality "Needs fixes". 4 Important (3 plan-mandated, 1 implementer-introduced) + 3 Minor.
Ruling: FIXING the open redirect. `redirectTo.startsWith('/')` admits `//evil.example`, which browsers follow off-site as protocol-relative. My code. Promoted to its own module src/lib/server/redirect.ts with tests rather than an inline expression, because it is a security guard and tasks 9/10 redirect too. Also rejects `/\host`, which some browsers normalise to `//host`. Cost if wrong: one small module to delete.
Ruling: FIXING the touch targets. PRD §12 makes 44px binding, not polish, and min-h-11 was applied to only 2 of 5 nav controls. Cost if wrong: a slightly taller navbar on an app that is explicitly mobile-first.
Ruling: FIXING the inert locale switcher. One line exempting /locale from the setup guard. The setup screen is the first thing a non-English operator sees and the control is visibly present but dead.
Ruling: PARTIALLY OVERRIDING the reviewer on the ESLint disable. It wanted the override scoped to one file; I am keeping it project-wide because scoping needs re-scoping in every later task that adds a link, which is churn for no safety. BUT the reviewer was right that the stated reason is false — svelte/no-navigation-without-resolve is about resolve() under a configured `base` path, NOT about whether a route exists, so Tasks 8/10 creating /groups and /profile will never satisfy it. A comment whose reason silently expires is worse than none. Required the comment rewritten to the true reason plus the condition for re-enabling. Cost if wrong: if a base path is ever configured every internal href breaks and the rule is off — hence the comment naming exactly that.
Ruling: folded 2 Minors into the round, both one-liners in a file already being edited — isSetupComplete(db) was called twice per request (two SQLite reads on every request against an RPi page-load budget), and the stale-cookie path inlined what clearSessionCookie already does, leaving that export dead.
Task 6: minor (deferred): startsWith('/setup') would also match a hypothetical /setupwizard; no such route exists or is planned
Task 6: fix round 1 dispatched (resumed original implementer)
Task 6: fix landed (commit 206a623, 45/45 passing, 1.41s, manual dev check passed including POST /locale pre-setup and against the open-redirect payload).
Task 6: IMPLEMENTER CORRECTED THE CONTROLLER AGAIN, and was right. My suggested one-liner merged /locale into the `setupRoute` variable, which also feeds the SECOND guard (`if (setupComplete && setupRoute) redirect(303,'/')`) — that would have bounced every POST-setup /locale submit to / unprocessed, i.e. fixed the switcher before setup and silently broken it after. It used separate setupPath and localeRoute variables so only the first guard is exempted. Carried to the re-reviewer as a four-way matrix to verify the correction is RIGHT, not merely different.
Task 6: this is the second time an implementer has caught a controller error (first: the 37-vs-36 test count in Task 5). Both times it reported rather than silently complying. Worth noting as evidence the "ask, don't guess" framing in the dispatches is doing real work.
Task 6: scoped re-review dispatched (sonnet, 79893ce..206a623) — asked it to actively try to defeat safeRedirectPath with a named list of bypass candidates, and to state which it tested by reading vs by reasoning.
Task 6: re-review verdict — Findings 2,3,4 + both Minors ADDRESSED; guard matrix verified correct across all four combinations. Finding 1 NOT fully addressed: a LIVE open-redirect bypass survives.
Task 6: the re-reviewer found it empirically, not by speculation: new URL("/<TAB>/evil.example", "https://good.example/") resolves to https://evil.example/, safeRedirectPath returns it unchanged (it starts with neither // nor /\), and Node's validateHeaderValue ACCEPTS a tab in a header value — so SvelteKit writes it to Location verbatim and the browser strips the tab per the WHATWG URL Standard and lands off-site. It further distinguished live from harmless: the \n and \r variants are rejected by Node's header validation and would 500 instead. Per the loop, new Important breakage keeps the finding open -> round 2.
Ruling: REJECT control characters outright rather than stripping them. Stripping would mean validating one string and returning another, which is the same shape of bug being closed.
Controller note: my fix instruction was mangled TWICE by the message channel eating escape sequences in a regex literal (both arrived as a nonsense character class that would have rejected ordinary paths). Caught it myself both times and re-sent; the third version avoids regex entirely and uses numeric code points, which cannot be garbled. Told the implementer to flag any code block that looks like it lost characters rather than guessing.
Task 6: fix round 2 dispatched (resumed original implementer)
Task 6: fix round 2/5 (1 addressed, 0 open — control characters rejected before the prefix checks; commits 206a623..934159e). 46 tests.
Task 6: final adversarial sweep found NO further bypass, and covered classes the two earlier sweeps had not named (U+FF0F full-width solidus, U+200E LRM, U+FEFF BOM, U+2028/2029, NEL, ZWSP, ideographic space, a lone "/", a 100k-char path, /@evil.example userinfo trick, /..%2f..%2f). Confirmed every off-origin resolver is rejected and every legitimate path still passes (/groups/abc?tab=pool#top, /gruppen/übersicht, percent-encoding, literal spaces). Also confirmed `fallback` is never attacker-influenced: the sole call site passes no second argument.
Task 6: complete (commits 328496a..934159e, review clean, 2 fix rounds)
Controller: committed 7ac3706 — propagated the extracted safeRedirectPath and the corrected two-variable setup guard into the plan doc, with the reasoning for both traps recorded.
SECURITY NOTE FOR THE FINAL REVIEW: safeRedirectPath is now the project's same-origin redirect guard. Tasks 9 and 10 also redirect — they must use it rather than open-coding a startsWith('/') check.
Task 7: dispatched (sonnet — first real UI, setup screen, users module; base 7ac3706)
Task 7: implementer DONE (commit 30eb9bb, 57/57 passing 1.24s, lint+check+build clean). Manual walkthrough passed all steps incl. error cases and the DE switch; implementer verified admin flag, timezone and setup_complete rows directly in the DB rather than trusting the UI. It also correctly diagnosed that curl's default Accept: */* makes SvelteKit form actions return JSON on fail() — a curl artefact, not an app bug — and re-tested with a browser-like Accept header.
Controller verification: $env still confined to db/index.ts; en.json/de.json have full key parity apart from the two deliberate test.* keys that exist only in English for the i18n fallback test (20 vs 18); no hardcoded English text nodes in the new routes.
INTERRUPTION: the Task 7 review agent was terminated mid-run by a session usage limit. State verified clean on resume — HEAD 30eb9bb, working tree clean, 57/57 passing, review package intact on disk. No work lost; re-dispatching the review only.
Task 7: review re-dispatched (sonnet, 7ac3706..30eb9bb)
Task 7: review verdict — spec ❌, quality "Needs fixes". 2 Important (both plan-mandated) + 3 Minor.
Ruling: FIXING the setup race. My code checked isSetupComplete BEFORE `await request.formData()`, i.e. check-yield-act, so two concurrent tabs can both read "not complete" and both mint an instance admin. The inline comment claiming the recheck "closes the race between two first visitors" is FALSE — it only covers sequential revisits, which hooks.server.ts already handles. Same class as the Task 4 comment that claimed a safety it did not provide. Also a partial-state path: a throw between createUser and setSetting('setup_complete') leaves an admin row with setup incomplete, and the next visitor mints a second admin. Fix extracts the logic to src/lib/server/setup.ts as claimInstance(), doing test-and-set inside a single transaction, with 4 tests. Cost if wrong: one small module; the route keeps its existing validation and error keys unchanged.
Ruling: the transaction deliberately passes `db` (not a `tx` handle) to the helpers inside. better-sqlite3 is a SINGLE connection, so BEGIN applies to every statement issued through db until COMMIT. Documented in the code so nobody "fixes" it by threading tx through createUser/setSetting. Cost if wrong: if the driver ever becomes multi-connection this silently stops being atomic — hence the comment naming the assumption.
Ruling: FIXING the mis-titled test. "gives two users with the same name different tokens" asserted only that a duplicate display name does not throw — it compared no tokens and would pass if createUser handed every user an identical token. FOURTH test in this project asserting something it never exercises (after Task 2's interpolation test, Task 5's cascade test, and this). Pattern is now established enough that every remaining review should be told to look for it explicitly.
Task 7: minor (deferred): home.welcome key added but unused by any current code
Task 7: minor (deferred): the "stores a login token hash" test can only format-check, since createUser deliberately never surfaces its token; the strict assertion exists in the regenerateLoginToken block
Task 7: fix round 1 dispatched (resumed original implementer)
Task 7: fix round 1/5 (2 addressed, 0 open — claimInstance test-and-set in one transaction; token-comparison test made real; commits 30eb9bb..52b3ec7). 61 tests.
Task 7: re-reviewer VERIFIED the single-connection atomicity claim at source level rather than accepting the comment — traced drizzle BaseSQLiteDatabase.transaction -> BetterSQLiteSession.transaction -> client.transaction -> better-sqlite3 transaction.js running BEGIN/COMMIT as prepared statements against the one native connection handle, confirmed db and tx wrap the same session/client, and confirmed claimInstance contains no await so the event loop cannot interleave between BEGIN and COMMIT. Also confirmed returning null commits an empty transaction harmlessly (only a throw rolls back). All four new tests verified to fail if their named behaviour were removed.
Task 7: complete (commits 7ac3706..52b3ec7, review clean, 1 fix round)
Task 8: dispatched (sonnet — groups, membership authorization, 404-not-403; base after plan commit)
Task 8: implementer DONE_WITH_CONCERNS (commit e86a36d, 69/69 passing ~1.5s, lint+check+build clean). Manual walkthrough passed including GET /groups/made-up-id returning 404, not 403 and not a crash.
Controller verification: groups.ts contains exactly ONE error() call and it is error(404) — no 403 path exists; $env still confined to db/index.ts; en/de parity holds at 28/26 (the 2-key gap is the deliberate English-only test.* keys).
Task 8: implementer concern carried to the reviewer — the "Owner" badge uses badge-sm per the brief; it judged a non-interactive text label falls outside the 44px touch-target rule, which governs controls a finger must hit. Asked the reviewer to confirm or reject that reading rather than pre-judging it. (Controller's own view: the implementer is right, but the reviewer decides.)
Task 8: FIRST TASK with an implementer test self-audit in the brief — required it to check each of its 8 tests against "would this still pass if the named behaviour were removed?" and report the conclusion. Reviewer told to verify those conclusions independently, since an audit that wrongly clears a hollow test is worse than no audit.
Task 8: review dispatched (sonnet, fb4abee..e86a36d)
Task 8: review verdict — spec ✅, quality APPROVED. 1 Important (plan-mandated) + 2 Minor. Every Critical-tier property verified from source: membership-gated reads, 404-not-403 indistinguishability (same query, same error call, same message for "wrong user" and "no such group" — no differential in status, body or control flow), leftAt filtering, idempotent re-activation, atomic group creation.
Task 8: the implementer's test self-audit was verified test-by-test by the reviewer, which CONCURRED IN FULL — all 8 genuinely fail if their named behaviour is removed. First task with no hollow test. The self-audit experiment is worth keeping for Tasks 9 and 10.
Task 8: reviewer CONFIRMED the implementer's badge-sm reading — a non-interactive label is not a touch target, so the 44px rule does not apply. Concern correctly raised and correctly resolved.
Ruling: FIXING the hardcoded-English error strings, but NOT the way the reviewer proposed. It suggested threading locale into the error() calls; I rejected that — it would put a locale parameter on requireMember, the core authorization primitive, for the sake of an error string, and repeat at every future call site. Instead: one src/routes/+error.svelte translating by status code, which covers 401/404/500 across the whole app at once and leaves the server-side error() messages as developer-facing log labels. Cost if wrong: one component to delete; the server code is untouched either way.
Ruling: the 404 message stays generic in every language. It is deliberately identical for "not a member" and "no such group" — that indistinguishability IS the security property the 404-not-403 rule exists for. Added a comment at the error() site so nobody later "fixes" it.
Task 8: minor (deferred): test 1's name says "in one transaction" but asserts only the end state; no mid-transaction-failure rollback test. Implementer self-flagged, reviewer agreed the nuance is accurately stated and out of scope.
Task 8: minor (deferred): no direct test that listGroupsFor/listMembers exclude a member who left; the isNull(leftAt) filters are correct but ride on inference from requireMember's test
Task 8: fix round 1 dispatched (resumed original implementer)
Task 8: fix round 1/5 (1 addressed, 0 open — translated error pages via +error.svelte; commits e86a36d..07c6c76). 69 tests, unchanged.
Task 8: re-reviewer confirmed the error page never references page.error.message (grep, zero hits), that the 404 renders byte-identically for both causes in both locales, that the German is real translation, and that the server-side error() strings were genuinely left untouched. It also traced hooks.server.ts to verify the retained `?? 'en'` fallback is currently unreachable but correctly kept — one ternary operand guarding an error thrown before the root layout load resolves.
Task 8: complete (commits fb4abee..07c6c76, review clean, 1 fix round)
Task 9: dispatched (sonnet — invite links, the path by which a stranger becomes a member; base after plan commit)
Task 9: implementer DONE_WITH_CONCERNS (commit 1fc6771, 79/79 passing ~2.0-2.2s, lint+check+build clean). Manual walkthrough passed end to end including the re-open check: DB showed 2 members and uses=1 after the stranger joined, and reopening the same link left both unchanged.
Controller verification: invites.ts imports and calls addMember with NO inlined onConflictDoUpdate — the requested de-duplication landed; both rateLimit call sites key on `join:${getClientAddress()}` only, nothing requester-controlled; en/de parity holds at 40/38.
Task 9: SELF-AUDIT CAUGHT A HOLLOW TEST BEFORE REVIEW — the brief's own lookupInvite "returns null for an unknown token" runs against an EMPTY invites table, so it is trivially true and never exercises hash-mismatch discrimination. That is the FIFTH such test in this project and the FIRST found at write time rather than review time. The implementer flagged it rather than silently altering a test it had been told to copy verbatim, which is the right call on both counts. Carried to the reviewer to confirm and to say what it should assert instead.
Task 9: second implementer concern carried unjudged — the readonly invite-URL input lacks min-h-11, per the brief; it judged a readonly field a display element rather than an activatable control. Told the reviewer that readonly (unlike disabled) is still keyboard-focusable and is exactly what users tap to select the link for copying, and let it decide.
Task 9: review dispatched (sonnet, 548cceb..1fc6771) — also asked whether the 1.5s -> 2.0s suite move is a real slow path or just per-file import overhead.
Task 9: review verdict — spec ❌, quality "Needs fixes". 3 Important (ALL plan-mandated) + 1 Minor + 1 warning item.
Ruling: FIXING the join-action check-yield-act. lookupInvite ran BEFORE `await request.formData()` and redeemInvite's return was discarded, so an invite expiring or filling during the yield still produced createSession + redirect — a live signed-in session for an account with NO group membership. This is the SAME SHAPE as the Task 7 setup race, and I wrote both; that is twice the same defect class from the same author, which is worth noting for the final review. Fixed identically: move the check past the last await, where the synchronous driver and single-threaded loop make the window genuinely closed, and check the redeem return anyway. Cost if wrong: one redundant guard.
Ruling: FIXING the hollow test with the reviewer's version (populate the table first so hash-mismatch is actually exercised). Reviewer independently confirmed the implementer's finding AND endorsed its decision to flag rather than silently edit a verbatim-required test.
Ruling: OVERRIDING the implementer on the readonly input — min-h-11 DOES apply. readonly (unlike disabled) keeps role=textbox, stays in the tab order, and is the entire point of that UI: the user taps in to select and copy the link. Its instinct to ask rather than decide silently was right; the answer just goes the other way.
Ruling: reviewer's ⚠️ RESOLVED by adding a rate limit to invite CREATION too. PRD §12 says "login and invite endpoints"; redemption was limited, creation was not. Ruled that creation counts — one line, and unbounded invite rows from one session is a mild disk DoS on the operator. Keyed on the authenticated user id, NOT the client address: an owner behind the same NAT as their friends must not share a bucket, and a session-derived id cannot be varied by the requester. Placed after the owner check so a non-owner gets 403 without consuming budget.
Task 9: minor (deferred): the "resolves a live token to its group" test also relies on there being exactly one invite row, though unlike the hollow one it does assert concrete join values
Task 9: reviewer confirmed the 1.5s -> 2.0s suite move is per-file Vitest worker + in-memory migration overhead from 10 new tests, not an added wait or slow path
Task 9: fix round 1 dispatched (resumed original implementer)
Task 9: fix round 1/5 (4 addressed, 0 open — join TOCTOU closed, hollow test made real, readonly input given min-h-11, invite-creation rate limit added; commits 1fc6771..0dea5db). 79 tests.
Task 9: re-reviewer checked the SIBLING path as asked — the route's `load` is not async and contains no await at all, so the check-yield-act race structurally cannot occur there and leaving it alone was correct. It noted `load` still discards redeemInvite's return, but with no yield point that cannot produce a stale outcome; recorded as a consistency nit, not a defect.
Task 9: complete (commits 548cceb..0dea5db, review clean, 1 fix round)
Task 10: dispatched (sonnet — personal login link, profile reveal, sign-out; LAST task; base after plan commit)
Task 10: implementer DONE (commit b66833a, 81/81 passing 2.03s across 11 files, lint+check+build clean). ALL EIGHT acceptance steps passed end to end: setup -> group -> invite -> reveal login link -> second-device login -> re-reveal kills the old link while existing sessions stay signed in -> DE switch persists across reload -> sign-out yields the translated 401.
Task 10: implementer reported an honest process hiccup — it removed data/ mid-investigation without restarting the dev server, so better-sqlite3 kept serving the old open database; it caught that itself, restarted clean, and redid the whole walkthrough rather than reporting the stale result. Flagged to the reviewer as a reason to read the walkthrough evidence carefully, not to dismiss it.
Task 10: two dead-code items carried to the reviewer unjudged — profile load returns `groups` the page never renders, and the `login.signed_in` key is added but never referenced (the login route redirects on success rather than rendering). Implementer kept both rather than silently deviating from a verbatim brief, which is the right instinct; reviewer decides.
Controller verification: login route keys on `login:${getClientAddress()}` only; /logout exports POST and nothing else; the profile's readonly login-URL input carries min-h-11 (the Task 9 ruling applied before it could become a finding); en/de parity holds at 49/47.
Task 10: review dispatched (sonnet, 4e289bb..b66833a) — LAST task review before the final whole-branch review.
Task 10: review verdict — spec ✅, quality APPROVED, ZERO Critical and ZERO Important. First task to clear its gate with no findings at all.
Task 10: reviewer traced every security control to its underlying primitive rather than accepting it — rate limit runs before the token lookup AND the shared counter increments on invalid attempts too, so flooding with bad tokens cannot buy extra attempts; regenerateLoginToken issues a single UPDATE on users and never touches the sessions table, which is why the old link dies AND live sessions survive (both halves structural, not merely test-observed); logout deletes the server row and clears the cookie with a path matching set-time. It also confirmed both new handlers are fully synchronous, so the check-yield-act class cannot recur there structurally.
Task 10: minor (deferred): profile load returns `groups` that the page never renders — dead fetch on every profile load; reviewer recommends removing the field and the listGroupsFor import
Task 10: minor (deferred): the login.signed_in key is unreferenced AND argues against the route's own design — a confirmation screen would prolong the token's time in the address bar; reviewer recommends dropping it from both locale files
Task 10: complete (commits 4e289bb..b66833a, review clean, 0 fix rounds)
ALL TEN TASKS COMPLETE. Proceeding to the final whole-branch review.

## FINAL WHOLE-BRANCH REVIEW (opus, dd21699..b66833a, 29 commits)

Verdict: Ready to merge WITH FIXES. 1 Critical, 8 Important, 11 Minor.

CRITICAL — `secure: !dev` bricks every plain-HTTP deployment, permanently and silently. `dev` is true only under `vite dev`. On http://pi.local:3000 — exactly the Raspberry Pi/Synology operator PRD §11 targets — setup completes and writes setup_complete, the browser DISCARDS the session cookie, the redirect 401s, and re-running /setup now bounces to / because setup is marked done. No error, no recovery except deleting the SQLite file. EIGHT prior task reviews and a hand-walked eight-step acceptance loop all missed it, because the walkthrough ran under `vite dev` where the flag is false. Controller wrote this line. Fix: `url.protocol === 'https:'`, which is correct behind a proxy because adapter-node derives it from ORIGIN.
PATTERN SWEEP — check-yield-act: CLEAN, no third instance. Mechanically verified: src/routes/** and hooks.server.ts contain exactly four `await` expressions, all `await request.formData()`, and every DB read happens after the await in each. Two near-misses named (the join load, safe only because it is not async; and the three-separate-transactions shape in the join action).
PATTERN SWEEP — hollow tests: THREE MORE FOUND, all the same family, in session.test.ts, backup.test.ts and settings.test.ts. One is byte-for-byte the same defect already fixed in users.test.ts — it survived in a different module because a different task owned it. That is the strongest argument yet that the per-task self-audit should have been a cross-cutting sweep from the start. Total found on this project: 8.
Final review also flagged TWO SPEC AMBIGUITIES in prd.md, not implementation bugs: §9 offers "revoke and regenerate" without saying whether revoking kills existing sessions (it currently does not), and §9's open-registration toggle plus §3's ownership transfer are specified with no plan owning them.
Final review fix wave dispatched as ONE dispatch (sonnet): 9 fixes — secure flag, session revocation on reveal, ON DELETE set null + migration regeneration, proxy address docs, GET-load mutation, 3 hollow tests, 2 missing leftAt tests, dead code + favicon/manifest/robots/error.403, rate-limit comment correction. Required a plain-HTTP production check via `node build`, since the dev server is structurally incapable of catching the Critical.
Final fix wave: ALL 9 ADDRESSED, no new Critical/Important breakage (commits b66833a..34d9197). 86 tests, 2.40s. Plain-HTTP production check via `node build` PASSED with every Set-Cookie lacking Secure; three-device revoke matrix verified (reveal keeps the revealing device alive, kills the other).
Re-reviewer read adapter-node's own handler.js to confirm url.protocol reports 'https:' behind a TLS-terminating proxy that sets ORIGIN — so the Critical fix does not trade one silent failure for another. It also confirmed the regenerated snapshot changed EXACTLY the two notNull/onDelete pairs and nothing else in the schema.

## RESIDUAL ADJUDICATION (no second fix wave; both parked with rulings)

Task final: parked — `login/[token]`'s load still calls createSession on a bare GET, the same SHAPE as the join-load mutation that was fixed. Ruling: the code stands. The login link is specified (PRD §9) as a URL a person pastes into an address bar, so GET is inherent to the design, not an oversight. Unlike the join case there is no attacker advantage: anyone who can trigger that request already holds the token, which is already full access — making the victim's own browser mint a session for the victim gains nothing. The preload-on-hover risk is bounded (no internal link to a login URL exists, and the effect would be creating a session for the token's rightful owner). Any real fix is a click-to-sign-in interstitial, which is a UX change to the app's most delicate flow and the user's call, not mine. Cost if wrong: a GET creates a session row and consumes a rate-limit slot for someone who already had full access.
Task final: parked — the German profile.reveal_warning keeps the sign-out consequence but drops the English version's "generates a new link" clause. Ruling: both strings are accurate and neither misleads; a literal mirror is not required and German word order makes the two-clause version clumsy. Cost if wrong: one translation string.
