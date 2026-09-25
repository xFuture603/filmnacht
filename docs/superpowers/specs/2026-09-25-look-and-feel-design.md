# Look and feel — Design

**Status:** approved in conversation 2026-09-25. Inserted before Task 6 of `plans/2026-09-25-nights-and-the-draw.md`, on branch `plan/05-nights-and-the-draw`, so the night pages are built once in this look.

## Intent

The app works but looks unfinished: stock daisyUI theme, a plain top navbar, pages styled ad hoc. The goal is a **clean modern app** a group of friends is happy to open on the sofa, on a phone, without learning anything.

What the user chose:
- **Mood:** clean modern — neutral, minimal, generous whitespace, one accent.
- **Accent:** warm amber.
- **Light/dark:** follows the device's system setting.
- **Mobile navigation:** bottom tab bar (daisyUI `dock`); slim top bar on desktop.

Constraints carried from the PRD: daisyUI on Tailwind (PRD §14 decision 12), mobile-first with ≥44 px touch targets and a PWA manifest (§ Mobile), privacy of a self-hosted instance (§12). Existing project rules: no JavaScript required for any action, `role="alert"` on errors, `min-h-11` on controls.

**Success:** every existing page and the new night pages share one visual language; at 390 px wide each primary action is reachable with a thumb; both themes pass WCAG AA contrast for text and for text on the accent.

## Theme

Two custom daisyUI 5 themes declared in `src/app.css` with `@plugin "daisyui/theme"`:

- `filmnacht-light` — `default: true`; `filmnacht-dark` — `prefersdark: true`. No theme switcher UI.
- Base colours: neutral greys (zinc family). Light: base-100 white, base-200 a hair darker for the page background. Dark: base-100 near-black grey, base-200 slightly darker.
- `primary`: warm amber (around `oklch(0.80 0.15 75)`), `primary-content`: near-black. Amber with white text fails AA; dark text on amber passes. The same pair in both themes.
- `secondary`/`accent`: muted neutrals — one accent colour means one. `error`/`success`/`warning`/`info` keep daisyUI's semantics, adjusted only where contrast needs it.
- Radii: boxes `1rem`, fields and buttons `0.5rem`. Depth: soft shadows, `--depth: 1`, `--noise: 0`.
- Font: the system UI stack (`ui-sans-serif, system-ui, …`). **No web fonts** — no request to Google Fonts or any third party, which also keeps the instance private.
- `static/manifest.webmanifest` and a `<meta name="theme-color">` pair (light and dark, via `media`) match the base colours. Manifest `name`/`short_name` become "Filmnacht".

## App shell (`src/routes/+layout.svelte`)

- **Top bar** (all widths): "🎬 Filmnacht" home link on the left. On `md` and up it also holds the nav links (Groups, Profile, Admin for admins) and the language select. On phones it holds only the title.
- **Dock** (below `md`, signed-in users only): fixed to the bottom, items Groups / Profile / Admin (admin only), each an icon plus a label; the current section gets `dock-active` and `aria-current="page"`. Main content gets bottom padding so the dock never covers it, including the iOS safe-area inset.
- **Language select on phones** moves to the Profile page (it is rarely used; the existing `/locale` POST action is reused unchanged).
- Main column: `max-w-3xl`, comfortable padding, `bg-base-200` page background with content on `base-100` cards.
- Signed-out pages (login, setup, join, reset) show the top bar without links and no dock.

## Group sections

Inside a group, a tab strip (daisyUI `tabs tabs-box`) under the group header switches between **Pool** (`/groups/[id]`) and **Nights** (`/groups/[id]/nights`). Each tab is a plain link to its own route, the active one marked with `aria-current="page"`. The Nights route is built by Task 6; until then the tab links to it and Task 6 fills it. Members and the invite control stay on the Pool page, below the pool, restyled as a list card.

## Shared components (`src/lib/components/`)

Only what at least two pages use:

| Component | Props | Used by |
| --- | --- | --- |
| `Icon.svelte` | `name`, `class?` | dock, empty states, buttons. A handful of inline SVG paths (groups, profile, admin, film, calendar, plus, dice). No icon package. |
| `PageHeader.svelte` | `title`, `subtitle?`, `action` snippet? | every signed-in page |
| `Poster.svelte` | `src`, `title` | pool grid, night detail. 2:3 aspect, lazy, `referrerpolicy="no-referrer"`; without a poster, a neutral tile showing the title in the tile itself — never an empty grey box with "no poster" text. |
| `EmptyState.svelte` | `icon`, `text`, `action` snippet? | empty pool, no groups, no nights |
| `FormCard.svelte` | `title`, children | login, setup, join, reset, reset/[token] — a centred narrow card |

## Pages

All twelve existing pages are restyled; behaviour, form fields, names, actions and i18n keys stay the same, so every server test keeps passing untouched. New i18n keys only where the new UI needs labels (dock labels reuse `nav.*`).

- **Groups list:** cards with emoji + name + role badge; EmptyState when none.
- **Group / Pool:** PageHeader with the group emoji and name, the tabs, the pool counter and the add button; the poster grid (2 columns on phones, up to 4 on desktop) with Poster, title, year · runtime, "yours" and "drawn" badges, and withdraw as a small ghost button; members and invite below in a card.
- **Add suggestion:** a form card; unchanged fields.
- **Profile:** grouped setting cards (display name, email, password, login link), plus the language select on phones.
- **Admin:** grouped setting cards.
- **Login, setup, join, reset, reset/[token]:** FormCard.
- **Error page:** centred, friendly, with a link home.

## Out of scope

Theme switcher, custom web fonts, animations beyond daisyUI defaults, a cross-group "next night" dashboard, PWA icons in PNG sizes (the SVG stays), any change to server code or routes other than the new Nights tab link.

## Verification

- `npm run check`, `npm run lint`, the full test suite — unchanged count, all passing.
- Production build (`node build/index.js`, throwaway DB under the scratch dir, never `data/`, never port 5599). Screenshot every page at 390×844 and 1280×800 in both themes; check that the dock never covers content, no page scrolls sideways, the focus ring is visible, and text on amber is legible.
- Contrast: compute primary/primary-content and base-content/base-100 contrast for both themes; each must be ≥ 4.5:1.
- The screenshots are shown to the user before the branch is merged.
