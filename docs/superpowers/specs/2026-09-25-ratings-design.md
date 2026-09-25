# Ratings — Design

**Status:** approved in conversation 2026-09-25. Implements PRD §7 (rating window, who may rate, scale, blind rating and the reveal, per-film figures). The user profile, hit rate and toughness (v1.0) are out of scope.

## Intent

After a movie night, every member rates the film. Nobody sees anyone else's score until the reveal, which the PRD calls "the most entertaining moment of the whole cycle". Then the group sees the average, who loved it and who hated it, and how far the group sits from TMDB.

Decisions the user made:
- **A rating can be changed or withdrawn until the reveal**, then it is locked.
- **The first rating on a night marks it watched**, so the fairness window stays right even when nobody pressed "We watched it".
- **Input is a slider** from 1 to 10 in half steps, with the chosen score shown large.

## Data (migration 0003)

- `movie_nights.revealed_at` — integer timestamp, nullable. Set once, never cleared.
- `ratings.user_id` foreign key changes from `set null` to `restrict`, with the same reasoning as `suggestions.suggested_by`: a deleted account must hand its ratings to the "former member" placeholder (PRD §4, §12) first, or fail loudly. `reassignToFormerMember` moves ratings as well as suggestions and reports both counts.
- The existing unique index `(movie_night_id, user_id)` stays: one rating per member per night.
- The migration is verified against a database migrated to 0002 that already holds a night and a rating, exactly as 0002 was.

## Rules (`src/lib/server/ratings.ts`)

Scores are stored as `score_x2`, an integer from 2 to 20. The form sends the score in half steps (`1`, `1.5`, … `10`); the server multiplies by two and rejects anything that is not an integer in range.

**The window.** A night is ratable when:
- its status is `drawn` or `watched` (never `scheduled` or `cancelled`), and
- now ≥ `scheduledAt + nightEndsAfterMinutes` (the night has ended), and
- now < that moment + `ratingWindowDays` days.

All three are computed on read from the group's settings; nothing runs on a timer.

**Who.** Any current member of the night's group. Authorization runs before anything is read or written.

**Save, change, withdraw.**
- Before the reveal: a member may save a rating, change it, or withdraw it.
- After the reveal: a member who has not rated may still add one while the window is open (PRD: late ratings append and move the average). An existing rating can no longer be changed or withdrawn.
- A comment is optional, trimmed, at most 500 characters (longer is refused, not clipped).

**First rating marks the night watched.** Saving a rating on a `drawn` night moves it to `watched` in the same transaction, with the same test-and-set `WHERE status = 'drawn'` as `markWatched`. The fairness window then counts the film, exactly as if the owner had pressed the button.

**The reveal** is stored, not derived, so it can never un-happen:
- **Automatic:** when a save makes it true that at least one current member answered "I'm in" and every such member has a rating for the night, `revealed_at` is set in the same transaction. With nobody answering "I'm in" there is no automatic reveal; otherwise the first rating would reveal itself.
- **Owner:** the owner presses "Reveal now" (with a confirm tick, server-checked, because it cannot be undone). Allowed once the night is ratable and has at least one rating.
- Once set, a later RSVP change or a withdrawn RSVP changes nothing.

**What each viewer receives** (the load function's payload, not merely the markup):
- **Before the reveal:** the viewer's own rating (score and comment), the number of ratings in, and the display names of who has rated and of "I'm in" members still missing — never another member's score or comment.
- **After the reveal:** every rating with display name, score and comment; the group average to one decimal (from the exact integer sum); the lowest and highest score with names (ties list every name); and, when the film has a TMDB score, the difference between the group average and TMDB.
- A rating owned by the former-member placeholder shows as "Former member".

## Screens

On the night page (`/groups/<id>/nights/<nightId>`), in the existing look:

- **Your rating** (when the window is open and the viewer may still act): a range input `min=1 max=10 step=0.5` named `score`, with the value shown large in an `<output>` updated by a small inline script (without JavaScript the slider still submits); an optional comment `textarea` with `maxlength=500`; "Save rating" and, if a rating exists before the reveal, "Withdraw". After the reveal, a viewer's existing rating shows read-only.
- **Progress** (before the reveal): "3 of 4 in · waiting for Grace". For the owner, "Reveal now" with a required confirm tick.
- **Results** (after the reveal): the average, lowest and highest with names, the TMDB difference when available, then every rating with name, score and comment.
- **Window messages:** "Rating opens when the night ends at {time}" before the window, "Rating closed on {date}" after it.

On the nights list, a past night that has been revealed shows its average next to its status.

All new copy exists in English and German. Every control keeps `min-h-11`; errors keep `role="alert"`; amber stays a fill.

## Out of scope

Profiles, hit rate, toughness, stats, rating reminders by email, the leaderboard, editing a rating after the reveal, per-film pages outside a night.

## Testing

- Window boundaries: one second before the night ends, at the end, at the last moment of the window, and one second after.
- Blind payload: before the reveal, `JSON.stringify` of the load result contains no other member's score or comment — seen to fail with the withholding removed.
- Automatic reveal: triggers when the last "I'm in" member rates; does not trigger with zero "I'm in" answers; is not undone by a later RSVP change.
- Change and withdraw work before the reveal and are refused after it; a late rating after the reveal is accepted.
- First rating on a `drawn` night marks it `watched`, and `candidatesFor` then counts it.
- `reassignToFormerMember` moves ratings; deleting an account with ratings but without reassigning fails.
- Owner-only reveal: 403 for a member, 404 for a non-member, refused without the confirm tick.
- Migration 0003 on a populated 0002 database keeps every row.
- A walkthrough on the production build (`node build/index.js`, throwaway database): two members rate, the reveal fires, results appear, the average shows on the nights list.
