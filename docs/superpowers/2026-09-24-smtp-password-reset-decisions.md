# Plan 4 — Optional SMTP and password reset: decisions

13 commits, 33 files. Suite 296 → 357. Branch complete and green.

Recovery now has three paths, and PRD §9's permanent rule — *login never depends on
SMTP* — is true again rather than true on paper.

| Credential | Obtained by | Revoked by |
| --- | --- | --- |
| Password | join, reset, admin recovery | password change, reset |
| Personal login link | `/profile?/reveal` (needs the password) | password change, reveal, reset |
| Session | any successful sign-in | password change, reveal, reset, logout |
| Reset token | `/reset`, `/admin?/recover` | use, expiry, **password change** (added late — see #7) |

---

## Rulings

**1. `sendMail` swallows every failure and never throws.** Its caller must answer
identically whether the address existed, whether the instance can send mail, and whether
the server was reachable. **A caller able to tell those apart will eventually leak one**,
so the distinction is destroyed at the source rather than carefully ignored at each call
site.

**2. A bare `catch` for mail errors.** nodemailer puts the host, the user and often the
password into the error and its `.response`. Identical class to Plan 2's TMDB key in a
request URL. The operator gets the one fact they can act on and nothing they must not
paste into a bug report.

**3. Half-configured counts as unconfigured.** A host with no From address is refused by
most servers; discovering that once per reset attempt is worse than saying so on the form.

**4. `nodemailer` is acceptable in a dependency-averse project because it has none.**
Verified: `npm view nodemailer dependencies` prints nothing, and installing it added
exactly two packages. What this codebase refuses is a dependency *tree* — and STARTTLS,
AUTH and MIME encoding are not the few lines that would make writing it cheaper.

**5. Consuming one reset token retires every outstanding token for that account.**
Found by mutation testing, which surfaced it as a **design gap in the plan rather than a
bug in the code**: requesting a reset twice and using the first link left the second live
for the rest of the hour.

**6. The mint and send happen after the response is decided.** The lookup costs the same
for a real address and an invented one; the insert and `createTransport` do not, and left
~1.4ms on ~1.7ms. Pinned **structurally** — the row must not exist yet when the action
returns — because a timing test here would be the kind that has twice passed against
broken code in this project.

**7. A password change retires outstanding reset links.** Found in the whole-branch pass
by walking the credential matrix, not by any test, because none existed either way.
`changePassword` rotated the login link and swept every session and left the reset token
alive, so a link in a mailbox outlived the password it was issued to reset and could
overwrite the one the member just chose — while the reason to be on that form may be a
reset email nobody requested. **The Plan 3 Major finding, one credential further out.**

**8. A refused password change retires nothing.** A wrong guess must not cost somebody
their recovery link; that would turn a typo into a denial of service on recovery.

**9. One rate-limit bucket for every re-authentication.** `/profile` password change,
`/profile` reveal and `/admin` recovery all verify **the same secret**, so a key per
action would hand an attacker 5 + 5 + 5 attempts against one password. Made structural by
routing all three through one `reauthenticate()` helper, and the key renamed from
`password-change:` to `reauth:` so the sharing is self-documenting.

**10. The admin's own password gates minting for somebody else.** Minting a credential for
another account is at least as powerful as revealing your own, which decision 21 gated. An
admin's unlocked laptop must not be a master key. Using the link sweeps the target's
sessions, so the member finds out.

**11. Minting is not revocation.** A recovery link leaves the target's password, sessions
and login link intact until it is actually used.

**12. The error log gets route patterns, never URLs.** SvelteKit's default `handleError`
prints the request URL, and **every token this app issues lives in a path** —
`/reset/<token>`, `/join/<token>`, `/login/<token>`. A 500 wrote a live single-use
credential into a file that outlives the request; observed twice on a production build.
**No task owned this**: the offending code was the framework's default and the three token
routes were written across three plans.

---

## Process rulings

**13. Writing an executable specification is about as error-prone as writing the code.**
Every task in this plan produced at least one plan defect — tests that could not work
because `$env` snapshots at config load, a TTL boundary asserting a distinction the
storage cannot represent, copy for a state the route can never reach (twice), an ungated
scrypt call, and five tests comparing `undefined` with `undefined`. The only reason they
were caught is that something independent ran them.

**14. A verification harness needs its own sanity check.** Twice my own mutation tooling
was the broken part: once grepping `^ *Tests ` against ANSI-coloured output, so every
result read as "not caught"; once replacing the first match of a string that occurred in a
**comment** before the code, producing a no-op mutation I reported as a survivor. Both
would have sent me hunting gaps that did not exist. **Assert the unmutated tree is green
before trusting any mutation result.**

**15. Not every surviving mutation is a missing test.** Some are equivalent programs. Two
were correctly identified as such rather than chased — one where a guard left below a hash
still ran it unconditionally, one where a mutant depended on `new Error().stack` containing
a substring that never appears under Vitest's transformed paths.

**16. The bug a plan still contains lives between two tasks.** The log-token leak and the
reset-link-survives-password-change gap were both invisible to five task reviews that were
each individually correct.

**17. A defect pattern proven five times still may not deserve shared infrastructure.**
Ruled against an `expectIdenticalResponses` helper: three of the four enumeration tests
already pair their relative comparison with an absolute anchor, the fourth is covered by
siblings, and each historical fix cost one line. Verified by mutation rather than assumed —
including correcting my own claim that a sixth occurrence existed.

---

## Deferred, with reasons

- **Reset mail is English on a bilingual instance.** `locals.locale` follows a header the
  requester controls, never the account, so honouring it leaks nothing — but it is two
  keys and no task needed it yet.
- **A no-SMTP instance still mints one undeliverable reset row per hand-made POST.** The
  plaintext is discarded so no credential exists; suppressing it would mean branching
  inside the enumeration-safe action, which is the one place a branch must not go.
- **`reveal` does not retire reset tokens.** It does not change the password, so a reset
  token is not made more dangerous by it. Only `changePassword` and a completed reset do.
- **`ORIGIN` unset degrades the CSRF check** once `Host`, `X-Forwarded-Host` and
  `X-Forwarded-Proto` are all forged. Not browser-reachable, and `.env.example` mandates
  `ORIGIN`.
- **Using a reset link while signed in as somebody else** silently switches accounts. A
  guard would break the common case of resetting while a stale session of your own is live.
