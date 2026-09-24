# Plan 3 — Username and password authentication: decisions

20 commits, 36 files, +2784/−127. Suite 132 → 288. Whole-branch verdict: SHIP.

This plan replaced login-link-only access with username-and-password authentication.
Seven defects were found and fixed during it. **Every one originated in the plan text
or a task brief — that is, in my own instructions — and not one was found by an
implementer's self-review or by a manual walkthrough.** All were caught either by a
scoped adversarial review or by an implementer refusing to type something wrong.

---

## Security rulings

**1. Never derive a cryptographic parameter from the value you are checking against.**
`verifyPassword` originally took `keylen` from the stored hash, making the length
comparison tautological: `'scrypt$AAAA$!!!'` decodes to zero bytes, scrypt returns zero
bytes, `timingSafeEqual(empty, empty)` is true, and **every password authenticated**.
Constants are now fixed and never read from input.

**2. Authorization before optimisation.** `/join` checked `usernameTaken` before looking
up the invite, so a junk token returned 400 `username_taken` for a real name and 410
`invite.invalid` for a fake one — an unauthenticated username oracle. The ordering was a
*legitimate* optimisation (avoid ~100ms of scrypt on the common failure) and that is
precisely why it was dangerous: the cheap check is usually the one touching
user-controlled state. Nothing that reveals instance state may run before the caller has
proven they may ask.

**3. Equal failure requires equal timing, and timing must be measured warm.** `/login`
calls `verifyPassword` unconditionally, hashing against random bytes when no account
exists, because an early return is microseconds where a real check is ~100ms. Verified at
≈1% median delta over 100 samples per arm.

**4. A per-username rate limit may never be the only gate.** `rate-limit.ts` evicts
oldest-first from one shared map. The address gate is primary and always checked.

**5. Causing eviction is not surviving it.** I wrote that the IP gate "cannot be evicted,
because the key is not one they choose". False — eviction is by insertion order and is
blind to who chose the key. The real property is that an attacker cannot **expand** the
IP key space: one key per source address, where usernames can be minted at will.

**6. Bound attacker-controlled values where they become keys.** The plan fed a raw form
field into a rate-limit key: 512KB bodies against `MAX_WINDOWS = 10_000` is multi-gigabyte
growth in a process-wide map. Bounded to 32 characters by `validateUsername`.

**7. Every revocation path must revoke every credential.** A password change rotated the
password and swept sessions but left `users.login_token_hash` alive — and `/login/[token]`
mints a session without consuming the token. An attacker on a borrowed session pressed
Reveal, the victim changed her password and was told "Every other device has been signed
out", and the kept link still worked. The action **shipped a string asserting a
remediation it did not perform**, at the moment a user was trying to evict an intruder.
The code's own comment stated the principle correctly and applied it to one of the two
ways in.

**8. Match constraint violations narrowly.** `createUser` matches
`SQLITE_CONSTRAINT_UNIQUE` **on `users.username` specifically** and rethrows everything
else, because `login_token_hash` is also unique and mislabelling that collision would
hide a real bug behind a reassuring message. `setEmail` mirrors it on `users.email`.

**9. Email is unique and lowercased.** Plan 4 must resolve an address to exactly one
account. Verified against the installed better-sqlite3: `UNIQUE` on a nullable column
permits many NULLs (optional email survives) and rejects duplicates — but accepts
`Ada@x.com` beside `ada@x.com`, so normalising before the write is load-bearing, not tidy.

---

## Testing rulings

**10. A hollow test on a security fix is worse than none.** It buys false confidence that
a fixed hole cannot reopen. Three of four original regression tests for the scrypt bypass
passed against the vulnerable code.

**11. A security test measured cold is not a security test.** The plan's login timing
test **passed against a vulnerable implementation**: the first request through an action
carries ~45ms of one-off module and JIT cost, which cleared the threshold on its own with
scrypt contributing nothing. Warm up, sample repeatedly, compare medians.

**12. Specifying only failure modes yields a suite that passes when the feature is
absent.** Every login test passed against an action whose whole body was
`return fail(400, ...)` — a suite in which nobody could sign in was 100% green.

**13. A revocation test must assert what survives as well as what dies.** "Revoke
everything" is satisfiable by an implementation that throws the legitimate user out
alongside the attacker — a different failure wearing the same success message.

**14. Pin behaviour to the error class, not the message text.** A fix whose correctness
rested on `err.message.includes('users.username')` could have been silently reverted by a
dependency bump with the suite still green.

**15. A measurement you have not validated is not evidence.** My own mutation harness
reported all five Task 6 mutations as "not caught" — it grepped `^ *Tests ` against
ANSI-coloured output, so every result was an empty string read as green. A verification
harness needs its own sanity check exactly as a security test needs to be seen failing.

---

## Process rulings

**16. `vite dev` is not the product, and has now hidden two security properties.**
SvelteKit skips the CSRF origin check entirely under it, and the `secure: !dev` Critical
survived ten reviews and a hand-walked acceptance loop because every one ran under the dev
server. **Any claim about cookie flags, CSRF, origin handling or transport must be made
against `node build/index.js`.**

**17. A manual walkthrough confirms the path you thought to walk.** Two walkthroughs on
this plan passed while a real regression was live, because neither happened to open an
invite while signed in. Worth running; never evidence of absence.

**18. When a brief restates existing code instead of pointing at it, the restatement
becomes the spec.** A pasted replacement body silently deleted an `if (locals.user)`
branch, forcing signed-in visitors into second accounts. Prefer "keep X, add Y".

**19. When a claim is wrong, grep for it.** The false eviction claim had been restated in
four plan locations including a live instruction to a later task. Fixing only the code
would have let the next implementer re-derive the false version.

**20. Per-task review covers tasks; harms do not respect task boundaries.** The signed-in
split-identity bug was fixed by the task that owned it. The identical harm for
signed-out-but-registered visitors was owned by nobody and survived every per-task review
until the whole-branch pass.

**21. Corrections need the same scrutiny as the code they correct.** The replacement for
the hollow timing test contained its own defect — asserting a 303 off a return value,
where `redirect()` throws.

---

## Deferred, with reasons

- **Changing your username** — frees the old one for someone else to claim, an
  impersonation vector in a group that identifies people by it, and invalidates every
  saved credential. Recorded in PRD §13 v1.0 backlog.
**22. Revealing a login link now requires the current password (decision 21).** Resolved
by the user after the trade-off was laid out. `reveal` minted the *more* powerful
credential — permanent, reusable, surviving logout and session expiry — on a bare session
cookie, while `changePassword` directly above it demanded re-authentication. Thirty
seconds at an unlocked laptop bought access that outlived the borrowed session.

Both actions share **one** rate-limit bucket through a single `reauthenticate()` helper,
because they guess the same secret and two keys would double the budget. Making it one
function rather than two call sites is what stops that being "tidied" apart later.

**The cost, recorded and not solved.** This narrows SMTP-free recovery from "any device
still signed in" to "a link saved in advance", and PRD §12's rule that *login never
depends on SMTP* is now strained rather than met: a member who forgets their password,
saved no link, and is still signed in has no self-service way back. There is no
admin-side reset in the product. The PRD says so plainly instead of rewriting the rule to
match the code, and the fix belongs to the plan that owns recovery — Plan 4 — rather than
to the change that created the gap.

**An honest GREEN in the mutation table.** Moving the shared rate limit to *after* the
verify, while still consuming on failure, is not caught by any test: it preserves the
entire observable contract and loses only "scrypt must not run before the gate", which is
observable by timing alone. The implementer deliberately did not add a timing test at
those margins — this plan has twice been bitten by timing tests that passed against broken
code — and documented the limit in the function comment instead. *Not every property is
worth a test; a property whose only test would be flaky is better named than faked.*
- **`setEmail` has no rate limit** (~73 probes/s measured). Authenticated-only; on a 3–12
  person instance the answer space is the member list the caller can already read, and
  probing overwrites the prober's own address. **Acceptance is conditional on instance
  size** and must be revisited if this ever runs publicly.
- **Account deletion** does not exist. `suggestions.suggested_by` is `ON DELETE SET NULL`
  and NULL means *wildcard*, so deleting an account would silently convert that person's
  films into wildcards and drop them from fairness counting. Latent, not live — it blocks
  whoever builds deletion.
- **Per-limiter-class rate-limit maps** — would make the address gate an unconditional
  floor. Not built: flooding needs ≥33 req/s sustained and cycling to evict one key costs
  ~10,000 insertions, more than the guesses it buys.
