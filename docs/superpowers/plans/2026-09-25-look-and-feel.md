# Look and feel — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give every page one clean, modern, mobile-first look — amber accent, system light/dark, a bottom dock on phones — before the night pages are built.

**Architecture:** Two custom daisyUI 5 themes in `app.css`; an app shell in `+layout.svelte` (top bar + dock); a handful of small presentational components in `src/lib/components/`; then every existing page rewritten to use them. No server code changes, so the server test suite is the regression net for behaviour; a headless-browser screenshot pass is the check for looks.

**Tech Stack:** SvelteKit 2 / Svelte 5 runes, Tailwind 4, daisyUI 5.7, Vitest.

**Spec:** `docs/superpowers/specs/2026-09-25-look-and-feel-design.md`. Runs on branch `plan/05-nights-and-the-draw` between Task 5 and Task 6 of `docs/superpowers/plans/2026-09-25-nights-and-the-draw.md`.

## Global Constraints

- **daisyUI 5 class names only.** The pages today use daisyUI 4 names that daisyUI 5 no longer ships — `form-control`, `label-text`, `label-text-alt`, `input-bordered`, `select-bordered`, `textarea-bordered`. They render as nothing, which is much of why the forms look broken. After this plan, `grep -rE "form-control|label-text|-bordered" src` returns nothing.
- **Amber is a fill, never text on a light background.** `primary` on `base-100` is 2.2:1 in the light theme. Buttons, badges and the active indicator use amber with `primary-content` (near-black) text. Links and labels use `base-content`. Measured contrast: ink on amber 8.1:1 (light theme), 10.5:1 (dark); body text 17.7:1 / 16.1:1; muted zinc-500 on white 4.8:1.
- **No JavaScript required for any action.** Every form still posts without JS. Nothing new may depend on client-side code.
- **Touch targets ≥ 44 px:** `min-h-11` on every button, link-button, input, select and tab.
- **`role="alert"` on every error and success message**, exactly as today.
- **No third-party requests:** no web fonts, no CDN, no icon package. The system font stack only.
- **Behaviour is frozen:** form field `name`s, `action`s, hidden inputs, `autocomplete`, `required`, `minlength`/`maxlength`, `aria-label`s and every i18n key in use stay the same. The existing server tests must pass untouched, and the count must not drop. Run the suite; never predict it.
- **Keep existing explanatory comments** in the page markup (for example the `redirectTo` hidden input, "No minlength", the one-form-around-the-table note). They record decisions, not styling.
- Never touch `data/`, never use port 5599, and never kill the user's `vite dev` process.

## Review Focus

1. **A long film title or group name at 390 px.** It must wrap or clamp, never push the page sideways. → Task 2 (`Poster`, `PageHeader` use `min-w-0` / `line-clamp`); checked in Task 5 at 390 px.
2. **The dock covering the last element of a page** — the withdraw button on the last poster, the admin table's last row, the logout button. → Task 3 gives `main` bottom padding of dock height plus safe-area; checked in Task 5 by scrolling to the bottom of the longest pages.
3. **A signed-out visitor.** No dock, but the language select must still be reachable, because they have no Profile page. → Task 3; checked in Task 5 on `/login` at 390 px.
4. **Dark mode on a page with an error alert and a disabled or ghost button.** Everything must stay legible. → Task 5 screenshots `/login` with an error, in the dark theme.
5. **Keyboard focus.** The focus ring must be visible on amber buttons, dock items and tabs in both themes. → Task 5 tabs through `/groups/<id>` and checks one screenshot with focus on the primary button.

---

## File Structure

| File | Responsibility |
| --- | --- |
| `src/app.css` | The two themes. |
| `src/app.html` | `theme-color` metas, `viewport-fit=cover`. |
| `static/manifest.webmanifest` | Name and colours. |
| `src/lib/components/Icon.svelte` | Inline SVG icons by name. |
| `src/lib/components/PageHeader.svelte` | Page title, optional emoji, subtitle and action. |
| `src/lib/components/Poster.svelte` | A 2:3 poster, or a tile showing the title. |
| `src/lib/components/EmptyState.svelte` | Icon, text and an optional action. |
| `src/lib/components/FormCard.svelte` | A centred narrow card for signed-out forms. |
| `src/lib/components/Field.svelte` | Label, control and hint (the daisyUI 5 `fieldset`). |
| `src/lib/components/LocaleSelect.svelte` | The language form, used by the layout and by Profile. |
| `src/lib/components/GroupTabs.svelte` | The Pool / Nights tab strip inside a group (Task 6 reuses it). |
| `src/routes/+layout.svelte` | Top bar and dock. |
| every `+page.svelte` under `src/routes`, plus `+error.svelte` | Restyled. |

`Field`, `LocaleSelect` and `GroupTabs` are additions to the spec's component table. Each is used by two or more pages, which is the spec's own rule for inclusion.

---

## Task 1: Themes and browser chrome

**Files:**
- Modify: `src/app.css`, `src/app.html`, `static/manifest.webmanifest`, `src/lib/i18n/en.json`, `src/lib/i18n/de.json`

**Interfaces:**
- Produces: themes `filmnacht-light` (default) and `filmnacht-dark` (used when the system prefers dark); i18n key `nav.main`.

- [ ] **Step 1: Replace `src/app.css`**

```css
@import 'tailwindcss';
@plugin 'daisyui' {
	themes: false;
}

/*
 * Clean modern, amber accent (docs/superpowers/specs/2026-09-25-look-and-feel-design.md).
 * Amber is a FILL: dark ink on amber is 8.1:1 (light) / 10.5:1 (dark), but amber text
 * on white is 2.2:1 and fails WCAG AA. Never use text-primary or link-primary on a
 * light surface.
 */
@plugin 'daisyui/theme' {
	name: 'filmnacht-light';
	default: true;
	color-scheme: light;
	--color-base-100: #ffffff;
	--color-base-200: #f4f4f5;
	--color-base-300: #e4e4e7;
	--color-base-content: #18181b;
	--color-primary: #f59e0b;
	--color-primary-content: #1c1917;
	--color-secondary: #e4e4e7;
	--color-secondary-content: #18181b;
	--color-accent: #f59e0b;
	--color-accent-content: #1c1917;
	--color-neutral: #27272a;
	--color-neutral-content: #fafafa;
	--color-info: #2563eb;
	--color-info-content: #ffffff;
	--color-success: #15803d;
	--color-success-content: #ffffff;
	--color-warning: #f59e0b;
	--color-warning-content: #1c1917;
	--color-error: #dc2626;
	--color-error-content: #ffffff;
	--radius-selector: 0.5rem;
	--radius-field: 0.5rem;
	--radius-box: 1rem;
	--size-selector: 0.25rem;
	--size-field: 0.25rem;
	--border: 1px;
	--depth: 1;
	--noise: 0;
}

@plugin 'daisyui/theme' {
	name: 'filmnacht-dark';
	prefersdark: true;
	color-scheme: dark;
	--color-base-100: #18181b;
	--color-base-200: #0f0f11;
	--color-base-300: #27272a;
	--color-base-content: #f4f4f5;
	--color-primary: #fbbf24;
	--color-primary-content: #1c1917;
	--color-secondary: #27272a;
	--color-secondary-content: #f4f4f5;
	--color-accent: #fbbf24;
	--color-accent-content: #1c1917;
	--color-neutral: #3f3f46;
	--color-neutral-content: #fafafa;
	--color-info: #60a5fa;
	--color-info-content: #0f0f11;
	--color-success: #4ade80;
	--color-success-content: #0f0f11;
	--color-warning: #fbbf24;
	--color-warning-content: #1c1917;
	--color-error: #f87171;
	--color-error-content: #0f0f11;
	--radius-selector: 0.5rem;
	--radius-field: 0.5rem;
	--radius-box: 1rem;
	--size-selector: 0.25rem;
	--size-field: 0.25rem;
	--border: 1px;
	--depth: 1;
	--noise: 0;
}

@layer base {
	html {
		font-family: ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
		-webkit-tap-highlight-color: transparent;
	}
}
```

- [ ] **Step 2: `src/app.html`.** Replace the viewport meta line and add the two theme colours after it:

```html
		<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
		<meta name="theme-color" content="#ffffff" media="(prefers-color-scheme: light)" />
		<meta name="theme-color" content="#18181b" media="(prefers-color-scheme: dark)" />
```

`viewport-fit=cover` is what makes `env(safe-area-inset-bottom)` non-zero on iPhones. The dock's own CSS and Task 3's padding depend on it.

- [ ] **Step 3: `static/manifest.webmanifest`.** Set `"name": "Filmnacht"`, `"short_name": "Filmnacht"`, `"background_color": "#18181b"`, `"theme_color": "#18181b"`. Leave the icons as they are.

- [ ] **Step 4: i18n.** In `en.json` set `"app.name": "Filmnacht"` and add `"nav.main": "Main navigation"`. In `de.json` set `"app.name": "Filmnacht"` and add `"nav.main": "Hauptnavigation"`. Keep each file's existing key order convention; `nav.main` goes after `nav.language`.

- [ ] **Step 5: Verify.** Run `npx vitest run`, `npm run check` and `npm run lint`. All must pass. The i18n parity test, if there is one, has to see the new key in both files. Then run `npm run build` and confirm that `build/client/_app/immutable/assets/*.css` contains `filmnacht-dark` and `prefers-color-scheme:dark`.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "style(theme): clean amber themes that follow the system setting"
```

---

## Task 2: Shared components

**Files:**
- Create: `src/lib/components/Icon.svelte`, `PageHeader.svelte`, `Poster.svelte`, `EmptyState.svelte`, `FormCard.svelte`, `Field.svelte`, `LocaleSelect.svelte`, `GroupTabs.svelte`

**Interfaces:**
- Produces (all under `$lib/components/`):
  - `Icon` — `{ name: IconName; class?: string }`, where `export type IconName = 'groups' | 'profile' | 'admin' | 'film' | 'calendar' | 'plus' | 'dice'` is exported from `<script module>`.
  - `PageHeader` — `{ title: string; emoji?: string | null; subtitle?: string; action?: Snippet }`
  - `Poster` — `{ src: string | null; title: string }`
  - `EmptyState` — `{ icon: IconName; text: string; action?: Snippet }`
  - `FormCard` — `{ title: string; intro?: string; children: Snippet }`
  - `Field` — `{ label: string; hint?: string; children: Snippet }`
  - `LocaleSelect` — `{ locale: Locale; pathname: string; class?: string }`
  - `GroupTabs` — `{ groupId: string; groupName: string; active: 'pool' | 'nights'; locale: Locale }`

These are presentational, with no logic worth a unit test. The project has no component-test setup, and adding one for these would be scaffolding. They are verified by `npm run check` here and by the screenshots in Task 5.

- [ ] **Step 1: `Icon.svelte`**

```svelte
<script module lang="ts">
	export type IconName = 'groups' | 'profile' | 'admin' | 'film' | 'calendar' | 'plus' | 'dice';

	// Hand-drawn 24×24 stroke icons. Inline rather than an icon package: seven
	// shapes do not justify a dependency. The strings are constants, so {@html}
	// here renders nothing a user supplied.
	const paths: Record<IconName, string> = {
		groups:
			'<circle cx="9" cy="8" r="3.5"/><path d="M2 20a7 7 0 0 1 14 0"/><path d="M16 4.5a3.5 3.5 0 0 1 0 7"/><path d="M18 14a7 7 0 0 1 4 6"/>',
		profile: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
		admin: '<path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/>',
		film: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M7 3v18M17 3v18M3 8h4M3 16h4M17 8h4M17 16h4"/>',
		calendar:
			'<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>',
		plus: '<path d="M12 5v14M5 12h14"/>',
		dice: '<rect x="4" y="4" width="16" height="16" rx="3"/><circle cx="9" cy="9" r="1" fill="currentColor"/><circle cx="12" cy="12" r="1" fill="currentColor"/><circle cx="15" cy="15" r="1" fill="currentColor"/>'
	};
</script>

<script lang="ts">
	let { name, class: className = 'size-6' }: { name: IconName; class?: string } = $props();
</script>

<svg
	class={className}
	viewBox="0 0 24 24"
	fill="none"
	stroke="currentColor"
	stroke-width="1.75"
	stroke-linecap="round"
	stroke-linejoin="round"
	aria-hidden="true"
>
	<!-- eslint-disable-next-line svelte/no-at-html-tags -->
	{@html paths[name]}
</svg>
```

- [ ] **Step 2: `PageHeader.svelte`**

```svelte
<script lang="ts">
	import type { Snippet } from 'svelte';
	let {
		title,
		emoji = null,
		subtitle,
		action
	}: { title: string; emoji?: string | null; subtitle?: string; action?: Snippet } = $props();
</script>

<header class="mb-6 flex flex-wrap items-end justify-between gap-3">
	<div class="min-w-0">
		<h1 class="text-2xl font-bold tracking-tight break-words">
			{#if emoji}<span aria-hidden="true" class="mr-1">{emoji}</span>{/if}{title}
		</h1>
		{#if subtitle}<p class="mt-1 text-sm text-base-content/70">{subtitle}</p>{/if}
	</div>
	{#if action}{@render action()}{/if}
</header>
```

- [ ] **Step 3: `Poster.svelte`**

```svelte
<script lang="ts">
	let { src, title }: { src: string | null; title: string } = $props();
</script>

<!-- alt="" on purpose: every poster sits next to its title in text, so a spoken
     alt would read the title twice. The no-poster tile shows the title because
     an empty grey box saying "no poster" tells nobody which film it is. -->
{#if src}
	<img
		class="aspect-[2/3] w-full rounded-box bg-base-300 object-cover"
		{src}
		alt=""
		loading="lazy"
		referrerpolicy="no-referrer"
	/>
{:else}
	<div
		class="flex aspect-[2/3] w-full items-end rounded-box bg-gradient-to-br from-base-300 to-base-200 p-3"
		aria-hidden="true"
	>
		<span class="line-clamp-4 text-sm font-semibold break-words">{title}</span>
	</div>
{/if}
```

- [ ] **Step 4: `EmptyState.svelte`**

```svelte
<script lang="ts">
	import type { Snippet } from 'svelte';
	import Icon, { type IconName } from './Icon.svelte';
	let { icon, text, action }: { icon: IconName; text: string; action?: Snippet } = $props();
</script>

<div
	class="flex flex-col items-center gap-3 rounded-box border border-dashed border-base-300 bg-base-100 px-6 py-10 text-center"
>
	<Icon name={icon} class="size-10 text-base-content/40" />
	<p class="text-base-content/70">{text}</p>
	{#if action}{@render action()}{/if}
</div>
```

- [ ] **Step 5: `FormCard.svelte`**

```svelte
<script lang="ts">
	import type { Snippet } from 'svelte';
	let { title, intro, children }: { title: string; intro?: string; children: Snippet } = $props();
</script>

<div class="mx-auto w-full max-w-md">
	<div class="card border border-base-300 bg-base-100 shadow-sm">
		<div class="card-body gap-4">
			<h1 class="text-2xl font-bold tracking-tight">{title}</h1>
			{#if intro}<p class="text-base-content/70">{intro}</p>{/if}
			{@render children()}
		</div>
	</div>
</div>
```

- [ ] **Step 6: `Field.svelte`**

```svelte
<script lang="ts">
	import type { Snippet } from 'svelte';
	let { label, hint, children }: { label: string; hint?: string; children: Snippet } = $props();
</script>

<!-- The wrapping <label> keeps the accessible name exactly as the pages had it.
     `fieldset` / `fieldset-legend` / `label` are daisyUI 5's own names for
     this layout; the daisyUI 4 ones (form-control, label-text) render as nothing. -->
<label class="fieldset">
	<span class="fieldset-legend text-sm">{label}</span>
	{@render children()}
	{#if hint}<span class="label text-xs whitespace-normal">{hint}</span>{/if}
</label>
```

Controls placed inside `Field` use `class="input min-h-11 w-full"`, `class="select min-h-11 w-full"` or `class="textarea w-full"`. daisyUI 5 inputs are bordered by default and 20rem wide unless told otherwise.

- [ ] **Step 7: `LocaleSelect.svelte`.** This is the layout's current form, moved out unchanged in behaviour:

```svelte
<script lang="ts">
	import { locales, t, type Locale } from '$lib/i18n';
	let {
		locale,
		pathname,
		class: className = ''
	}: { locale: Locale; pathname: string; class?: string } = $props();
</script>

<form method="POST" action="/locale" class={className}>
	<input type="hidden" name="redirectTo" value={pathname} />
	<select
		name="locale"
		class="select min-h-11 w-auto"
		aria-label={t(locale, 'nav.language')}
		onchange={(e) => e.currentTarget.form?.requestSubmit()}
	>
		{#each locales as l (l)}
			<option value={l} selected={l === locale}>{l.toUpperCase()}</option>
		{/each}
	</select>
	<noscript><button class="btn min-h-11">{t(locale, 'common.save')}</button></noscript>
</form>
```

If `Locale` is not exported from `$lib/i18n`, import the type the layout's `data.locale` already has. Check `src/lib/i18n/index.ts`; `+error.svelte` already imports `type Locale` from there.

- [ ] **Step 8: `GroupTabs.svelte`**

```svelte
<script lang="ts">
	import { t, type Locale } from '$lib/i18n';
	let {
		groupId,
		groupName,
		active,
		locale
	}: { groupId: string; groupName: string; active: 'pool' | 'nights'; locale: Locale } = $props();
	const tabs = $derived([
		{ id: 'pool', href: `/groups/${groupId}`, label: t(locale, 'pool.title') },
		{ id: 'nights', href: `/groups/${groupId}/nights`, label: t(locale, 'nights.title') }
	] as const);
</script>

<!-- Links, not ARIA tabs: each is its own page and works without JavaScript. -->
<!-- Labelled with the group's name, not "Main navigation": this is the
     group's own sections, and one page must not carry two identical landmarks. -->
<nav class="tabs tabs-box mb-6 w-fit" aria-label={groupName}>
	{#each tabs as tab (tab.id)}
		<a
			class={['tab min-h-11', tab.id === active && 'tab-active']}
			href={tab.href}
			aria-current={tab.id === active ? 'page' : undefined}>{tab.label}</a
		>
	{/each}
</nav>
```

- [ ] **Step 9: Verify.** Run `npm run check` and `npm run lint`, and fix anything they report. The components are unused until Task 3, so the suite is unchanged.

- [ ] **Step 10: Commit**

```bash
git add -A
git commit -m "style(ui): shared page components for the new look"
```

---

## Task 3: App shell — top bar and dock

**Files:**
- Modify: `src/routes/+layout.svelte`, `src/routes/+error.svelte`

**Interfaces:**
- Consumes: `Icon`, `LocaleSelect` (Task 2); layout data `{ locale, user, pathname }` from `src/routes/+layout.server.ts` (unchanged).

- [ ] **Step 1: Replace `src/routes/+layout.svelte`**

```svelte
<script lang="ts">
	import '../app.css';
	import { t } from '$lib/i18n';
	import Icon, { type IconName } from '$lib/components/Icon.svelte';
	import LocaleSelect from '$lib/components/LocaleSelect.svelte';

	let { data, children } = $props();

	const sections = $derived(
		[
			{ href: '/groups', label: t(data.locale, 'nav.groups'), icon: 'groups' as IconName },
			{ href: '/profile', label: t(data.locale, 'nav.profile'), icon: 'profile' as IconName },
			...(data.user?.isAdmin
				? [{ href: '/admin', label: t(data.locale, 'nav.admin'), icon: 'admin' as IconName }]
				: [])
		].map((s) => ({
			...s,
			current: data.pathname === s.href || data.pathname.startsWith(`${s.href}/`)
		}))
	);
</script>

<div class="min-h-dvh bg-base-200">
	<header
		class="navbar sticky top-0 z-10 min-h-14 border-b border-base-300 bg-base-100/90 px-4 backdrop-blur"
	>
		<a class="flex min-h-11 items-center gap-2 text-lg font-semibold" href="/">
			<span aria-hidden="true">🎬</span>{t(data.locale, 'app.name')}
		</a>
		<div class="flex-1"></div>
		{#if data.user}
			<nav class="hidden gap-1 md:flex" aria-label={t(data.locale, 'nav.main')}>
				{#each sections as s (s.href)}
					<a
						class={['btn btn-ghost min-h-11', s.current && 'btn-active']}
						href={s.href}
						aria-current={s.current ? 'page' : undefined}>{s.label}</a
					>
				{/each}
			</nav>
		{/if}
		<!-- Signed in: on phones the language select lives on /profile, so the bar
		     stays uncluttered. Signed out: there is no profile, so it stays here. -->
		<LocaleSelect
			locale={data.locale}
			pathname={data.pathname}
			class={['ml-2', data.user && 'hidden md:block'].filter(Boolean).join(' ')}
		/>
	</header>

	<main
		class={[
			'mx-auto max-w-3xl px-4 py-6',
			data.user && 'pb-[calc(5rem+env(safe-area-inset-bottom))] md:pb-6'
		]}
	>
		{@render children()}
	</main>

	{#if data.user}
		<nav class="dock md:hidden" aria-label={t(data.locale, 'nav.main')}>
			{#each sections as s (s.href)}
				<a
					href={s.href}
					class={['min-h-11', s.current && 'dock-active font-semibold']}
					aria-current={s.current ? 'page' : undefined}
				>
					<Icon name={s.icon} class="size-6" />
					<span class="dock-label">{s.label}</span>
				</a>
			{/each}
		</nav>
	{/if}
</div>
```

The top bar and the dock carry the same `aria-label`, but only one of them is ever visible; the other is `display:none`. So assistive tech sees one "Main navigation" landmark at a time.

- [ ] **Step 2: Replace the markup of `src/routes/+error.svelte`.** Keep the `<script>` block exactly as it is:

```svelte
<div class="mx-auto flex max-w-md flex-col items-center gap-4 py-12 text-center">
	<p class="text-6xl font-bold tracking-tight text-base-content/30">{page.status}</p>
	<p class="text-lg">{t(locale, key)}</p>
	<a class="btn btn-primary min-h-11" href="/">{t(locale, 'error.home')}</a>
</div>
```

The status number was an `<h1>`, and now it's a `<p>`. Before changing it, grep the route tests for an assertion on the heading. If one exists, keep it an `<h1>` with the same classes.

- [ ] **Step 3: Verify.** Run `npx vitest run`, `npm run check` and `npm run lint`. The count must match the pre-task count. Run `npm run dev -- --port 5610` briefly, load `/login`, and confirm the page renders with the new bar and no console errors. Stop the dev server.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "style(shell): top bar on desktop, dock on phones"
```

---

## Task 4: Restyle every page

**Files:**
- Modify: `src/routes/login/+page.svelte`, `src/routes/login/[token]/+page.svelte`, `src/routes/setup/+page.svelte`, `src/routes/join/[token]/+page.svelte`, `src/routes/reset/+page.svelte`, `src/routes/reset/[token]/+page.svelte`, `src/routes/groups/+page.svelte`, `src/routes/groups/[groupId]/+page.svelte`, `src/routes/groups/[groupId]/add/+page.svelte`, `src/routes/profile/+page.svelte`, `src/routes/admin/+page.svelte`; `src/lib/i18n/en.json` and `de.json` only if a key becomes unused (see Step 6)

**Interfaces:**
- Consumes: every component from Task 2.

**The mechanical rule for every form field on every page.** Replace this:

```svelte
<label class="form-control">
	<span class="label-text">{LABEL}</span>
	<input … class="input input-bordered min-h-11" />
	<span class="label-text-alt">{HINT}</span>
</label>
```

with this, keeping every attribute on the control except `class`:

```svelte
<Field label={LABEL} hint={HINT}>
	<input … class="input min-h-11 w-full" />
</Field>
```

Omit `hint` when there was no `label-text-alt`. For controls, `select select-bordered` becomes `select min-h-11 w-full`, and `textarea textarea-bordered` becomes `textarea w-full`. For a read-only URL field (a login link, an invite link, a recovery link), `input input-bordered … w-full` becomes `input min-h-11 w-full font-mono text-sm`. Comments that sat inside the old `<label>` move inside the `Field`, directly above the control.

**Buttons:** the primary action stays `btn btn-primary min-h-11`. On phones, a form's submit button is full width and becomes inline from `sm` up: add `w-full sm:w-auto` and drop `self-start`. Secondary actions use `btn-ghost` or `btn-outline`; `btn-secondary` is gone because the secondary colour is now a neutral grey.

**Alerts:** unchanged, apart from adding `alert-soft` to make them calmer (`alert alert-error alert-soft`). Keep `role="alert"`.

- [ ] **Step 1: Signed-out pages use `FormCard`.**

`login/+page.svelte`:

```svelte
<script lang="ts">
	import { t } from '$lib/i18n';
	import FormCard from '$lib/components/FormCard.svelte';
	import Field from '$lib/components/Field.svelte';
	let { data, form } = $props();
</script>

<FormCard title={t(data.locale, 'login.title')}>
	{#if form?.error}
		<div class="alert alert-error alert-soft" role="alert">{t(data.locale, form.error)}</div>
	{/if}

	<form method="POST" class="flex flex-col gap-2">
		<!-- Without this the action's form.get('redirectTo') is always null and
		     every sign-in lands on /groups, silently dropping the deep link. -->
		<input type="hidden" name="redirectTo" value={data.redirectTo} />

		<Field label={t(data.locale, 'auth.username')}>
			<input name="username" required autocomplete="username" class="input min-h-11 w-full" />
		</Field>

		<Field label={t(data.locale, 'auth.password')}>
			<!-- No minlength: the login form is not the place to publish the password
			     rules, and a client-side bound that disagrees with the server would
			     only ever lock someone out of their own account. -->
			<input
				name="password"
				type="password"
				required
				autocomplete="current-password"
				class="input min-h-11 w-full"
			/>
		</Field>

		<button class="btn btn-primary mt-2 min-h-11 w-full">{t(data.locale, 'login.submit')}</button>
	</form>

	<p class="text-sm text-base-content/70">
		{t(data.locale, 'login.forgot')}
		<a class="link" href="/reset">{t(data.locale, 'reset.title')}</a>
	</p>
</FormCard>
```

On signed-out cards the submit button is full width at every size, because the card is narrow. Apply the same shape to:
- **`setup`:** title `setup.title`, intro `setup.intro`. Five `Field`s, following the mechanical rule; the timezone `select` keeps its `{#each}` and `selected`.
- **`reset`:** title `reset.title`. Both alerts go inside the card, and the `{#if data.mailConfigured}` branches are unchanged. The no-mail `<p>` gets `text-base-content/70`.
- **`reset/[token]`:** title `reset.choose_title`, and the closing hint `<p>` gets `text-sm text-base-content/70`.
- **`join/[token]`:** in the `data.invite` branch, `FormCard` is titled with `invite.join_title` and gets the same inner structure: the signed-in join button and the signed-out form. The rate-limited and invalid branches render their alert inside `<div class="mx-auto w-full max-w-md">`.
- **`login/[token]`:** its single alert goes inside `<div class="mx-auto w-full max-w-md">`.

- [ ] **Step 2: `groups/+page.svelte`**

```svelte
<script lang="ts">
	import { t } from '$lib/i18n';
	import PageHeader from '$lib/components/PageHeader.svelte';
	import EmptyState from '$lib/components/EmptyState.svelte';
	import Field from '$lib/components/Field.svelte';
	let { data, form } = $props();
</script>

<PageHeader title={t(data.locale, 'groups.title')} />

{#if data.groups.length === 0}
	<div class="mb-8"><EmptyState icon="groups" text={t(data.locale, 'groups.empty')} /></div>
{:else}
	<ul class="mb-8 grid gap-3 sm:grid-cols-2">
		{#each data.groups as group (group.id)}
			<li>
				<a
					href="/groups/{group.id}"
					class="card flex min-h-11 flex-row items-center gap-3 border border-base-300 bg-base-100 p-4 shadow-sm transition hover:shadow-md"
				>
					<span class="text-3xl" aria-hidden="true">{group.emoji ?? '🎬'}</span>
					<span class="min-w-0 flex-1 truncate font-semibold">{group.name}</span>
					{#if group.role === 'owner'}
						<span class="badge badge-sm">{t(data.locale, 'groups.owner')}</span>
					{/if}
				</a>
			</li>
		{/each}
	</ul>
{/if}

<section class="card border border-base-300 bg-base-100 shadow-sm">
	<div class="card-body">
		<h2 class="card-title text-lg">{t(data.locale, 'groups.create')}</h2>
		{#if form?.error}
			<div class="alert alert-error alert-soft" role="alert">{t(data.locale, form.error)}</div>
		{/if}
		<form method="POST" action="?/create" class="flex flex-col gap-2">
			<Field label={t(data.locale, 'groups.name')}>
				<input name="name" required maxlength="60" class="input min-h-11 w-full" />
			</Field>
			<Field label={t(data.locale, 'groups.emoji')}>
				<input name="emoji" maxlength="8" class="input min-h-11 w-24" />
			</Field>
			<button class="btn btn-primary mt-2 min-h-11 w-full sm:w-auto sm:self-start"
				>{t(data.locale, 'groups.create')}</button
			>
		</form>
	</div>
</section>
```

`listGroupsFor` already returns `role`. If `groups.owner` doesn't render on the groups list because of something in the load, drop the badge rather than touching server code.

- [ ] **Step 3: `groups/[groupId]/+page.svelte`**

```svelte
<script lang="ts">
	import { t } from '$lib/i18n';
	import PageHeader from '$lib/components/PageHeader.svelte';
	import GroupTabs from '$lib/components/GroupTabs.svelte';
	import Poster from '$lib/components/Poster.svelte';
	import EmptyState from '$lib/components/EmptyState.svelte';
	import Icon from '$lib/components/Icon.svelte';
	let { data, form } = $props();
</script>

<PageHeader title={data.group.name} emoji={data.group.emoji ?? '🎬'} />
<GroupTabs
	groupId={data.group.groupId}
	groupName={data.group.name}
	active="pool"
	locale={data.locale}
/>

{#if form?.error}
	<div class="alert alert-error alert-soft mb-4" role="alert">{t(data.locale, form.error)}</div>
{/if}

<section class="mb-8">
	<div class="mb-4 flex flex-wrap items-center justify-between gap-3">
		<p class="text-sm text-base-content/70">
			{t(data.locale, 'pool.count', { used: data.used, max: data.max })}
		</p>
		<a class="btn btn-primary min-h-11" href="/groups/{data.group.groupId}/add">
			<Icon name="plus" class="size-5" />{t(data.locale, 'pool.add')}
		</a>
	</div>

	{#if data.pool.length === 0}
		<EmptyState icon="film" text={t(data.locale, 'pool.empty')} />
	{:else}
		<ul class="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4">
			{#each data.pool as entry (entry.suggestionId)}
				<li class="flex min-w-0 flex-col gap-2">
					<Poster src={entry.posterUrl} title={entry.title} />
					<div class="min-w-0">
						<p class="line-clamp-2 font-medium break-words">{entry.title}</p>
						<p class="text-sm text-base-content/70">
							{entry.year ?? ''}{entry.runtime ? ` · ${entry.runtime} min` : ''}
						</p>
						<div class="mt-1 flex flex-wrap gap-1">
							{#if entry.status === 'drawn'}
								<span class="badge badge-sm badge-neutral">{t(data.locale, 'pool.drawn')}</span>
							{/if}
							{#if entry.mine}
								<span class="badge badge-sm badge-primary">{t(data.locale, 'pool.yours')}</span>
							{/if}
						</div>
						{#if entry.mine && entry.status === 'open'}
							<form method="POST" action="?/withdraw">
								<input type="hidden" name="suggestionId" value={entry.suggestionId} />
								<button
									class="btn btn-ghost btn-sm mt-1 min-h-11 w-full"
									aria-label={t(data.locale, 'pool.withdraw_named', { title: entry.title })}
								>
									{t(data.locale, 'pool.withdraw')}
								</button>
							</form>
						{/if}
					</div>
				</li>
			{/each}
		</ul>
	{/if}
</section>

<section class="card border border-base-300 bg-base-100 shadow-sm">
	<div class="card-body">
		<h2 class="card-title text-lg">{t(data.locale, 'groups.members')}</h2>
		<ul class="divide-y divide-base-300">
			{#each data.members as member (member.id)}
				<li class="flex min-h-11 items-center justify-between gap-2 py-2">
					<span class="min-w-0 truncate">{member.displayName}</span>
					{#if member.role === 'owner'}
						<span class="badge badge-sm">{t(data.locale, 'groups.owner')}</span>
					{/if}
				</li>
			{/each}
		</ul>

		{#if data.group.role === 'owner'}
			<form method="POST" action="?/invite" class="mt-2">
				<button class="btn btn-outline min-h-11 w-full sm:w-auto"
					>{t(data.locale, 'invite.create')}</button
				>
			</form>
			{#if form?.inviteUrl}
				<p class="mt-2 text-sm">{t(data.locale, 'invite.created')}</p>
				<input class="input min-h-11 w-full font-mono text-sm" readonly value={form.inviteUrl} />
			{/if}
		{/if}
	</div>
</section>
```

The "Movie nights" tab links to `/groups/<id>/nights`, which Task 6 of the nights plan creates. Until then it 404s. That's expected, and it doesn't count as a finding.

- [ ] **Step 4: `groups/[groupId]/add/+page.svelte`.**
- **Header:** `PageHeader` with title `add.title` (with `{ group: data.group.name }`).
- **TMDB search:** the search block becomes a card (`card border border-base-300 bg-base-100 shadow-sm` → `card-body`) with `card-title` set to `add.search_heading`. The search form keeps its `flex gap-2`, and its input becomes `input min-h-11 w-full flex-1`.
- **Results grid:** same grid as the pool. Each result is `Poster` plus the title (`line-clamp-2 font-medium`), the year, and its adopt button as `btn btn-primary btn-sm min-h-11 w-full`, with its `name`, `value` and `aria-label` unchanged.
- **Note field:** the note `Field` under the results keeps its place inside the adopt form.
- **Manual entry:** the manual block becomes a second card with `card-title` set to `add.manual_heading`. It has three `Field`s and a submit button of `btn btn-primary min-h-11 w-full sm:w-auto sm:self-start`.
- **Back link:** stays at the end, as `btn btn-ghost min-h-11`.
- **Disabled search:** the `add.search_disabled` alert becomes `alert alert-info alert-soft`, keeping `role="status"`.

- [ ] **Step 5: `profile/+page.svelte`.**
- **Header:** `PageHeader` with title `profile.title`, and both alerts below it.
- **Cards:** every current `<h2>` section becomes its own card, in the current order (`card border border-base-300 bg-base-100 shadow-sm mb-4` → `card-body` → `h2.card-title.text-lg`). Username is read-only text plus the `profile.username_fixed` note in `text-sm text-base-content/70`. Then the display name form, the email form, and the password form.
- **Login link:** a card holding the hint, the warning, the reveal form (its submit becomes `btn btn-outline`), and the revealed URL field.
- **Language, phones only:** a new card with `class="... md:hidden"`, `card-title` set to `nav.language`, and `<LocaleSelect locale={data.locale} pathname="/profile" />`. `data.locale` is available because layout data merges into page data.
- **Log out:** stays last, as `btn btn-ghost min-h-11 w-full sm:w-auto`.

Every field follows the mechanical rule. Keep the `aria-label` on the reveal password input and its comment.

- [ ] **Step 6: `admin/+page.svelte`.**
- **Header:** `PageHeader` with title `admin.title`.
- **Recovery result:** the success alert stays, and the URL field follows the read-only rule.
- **Members card:** the members section becomes one card with `card-title` set to `admin.members`, and the hint in `text-sm text-base-content/70`.
- **Recover form:** the single `recover` form keeps wrapping both the password `Field` and the table. The table becomes `table table-sm`, and each row's button becomes `btn btn-outline btn-sm min-h-11`, with its `name`, `value` and `aria-label` unchanged. Keep both comments.

- [ ] **Step 7: Remove only what became unused.** `pool.no_poster` is no longer rendered by the pool or the add page. Grep for it. If nothing uses it, delete it from both `en.json` and `de.json`; the i18n parity test must still pass. Delete no other key.

- [ ] **Step 8: Verify.**

```bash
grep -rnE "form-control|label-text|input-bordered|select-bordered|textarea-bordered|btn-secondary" src
```

Expected: no output. Then run `npx vitest run` (count unchanged from before Task 1, minus nothing), `npm run check` and `npm run lint`.

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "style(pages): every page in the new look, on daisyUI 5 classes"
```

---

## Task 5: Look at it — screenshots on the production build

**Files:**
- Modify: whatever the screenshots show to be wrong. If nothing is, this task changes no code and says so.
- Scratch only (never committed): the seed script, the browser profiles, and the PNGs under `/tmp/claude-1000/-home-xfuture-code-filmnacht/145ae8bd-69f7-4ba4-a1ff-f80465011cf1/scratchpad/look/`.

- [ ] **Step 1: Build and run on a throwaway database.**

```bash
npm run build
S=/tmp/claude-1000/-home-xfuture-code-filmnacht/145ae8bd-69f7-4ba4-a1ff-f80465011cf1/scratchpad/look
mkdir -p $S
DATABASE_PATH=$S/filmnacht.db ORIGIN=http://localhost:5611 PORT=5611 node build/index.js
```

Run it in the background. Never use `data/`, and never use port 5599.

- [ ] **Step 2: Seed through the real UI flow where possible.** Complete `/setup` with a script of `fetch` POSTs:
  - pass `Origin: http://localhost:5611` and carry the session cookie
  - create a group with a long name, for Review Focus 1
  - add four films through the manual form, one with a very long title and none with posters
  - create an invite and join with a second account

To get the screenshot browser signed in, reveal the admin's login link from `/profile?/reveal` (POST with the password). `/login/<token>` is a GET that sets the session cookie.

- [ ] **Step 3: Screenshots.** Use headless Firefox (`/usr/bin/firefox`) with two persistent profiles under `$S`:
  - **`light`:** `user.js` sets `user_pref("layout.css.prefers-color-scheme.content-override", 1);`
  - **`dark`:** the same pref, set to `0`

For each profile, first load `/login/<token>` once so the profile holds the session cookie. Then, for each page (`/login` signed out, from a third profile with no cookie; `/setup` is not reachable after setup and is skipped; `/groups`, `/groups/<id>`, `/groups/<id>/add`, `/profile`, `/admin`, a 404 page, `/join/<valid-token>` signed out), take one shot at each size:

```bash
firefox --headless -profile $S/light --screenshot $S/light-390-groups.png --window-size=390,844 http://localhost:5611/groups
firefox --headless -profile $S/light --screenshot $S/light-1280-groups.png --window-size=1280,800 http://localhost:5611/groups
```

If Firefox refuses a second headless instance while one is running, run them one after another. If the session cookie doesn't survive between runs because it is a session cookie, add `user_pref("browser.sessionstore.resume_session_once", false);` and instead log in on every shot by screenshotting `/login/<token>?redirectTo=<page>`, if the route honours `redirectTo`. If neither works, report NEEDS_CONTEXT with what you saw. Do not install anything into the project.

Also capture:
- the `/login` page after a failed sign-in, in dark: POST it with a wrong password via fetch, then screenshot the response HTML saved to `$S/login-error.html` and opened as a file
- `/groups/<id>` at 390 px with `--window-size=390,2400`, to see the bottom of the page and the dock clearance

- [ ] **Step 4: Check each screenshot against this list** and write what you see, per image, into the report:
  - no sideways scroll or cut-off text at 390 px (long group name, long film title)
  - the dock shows on phones when signed in, is absent when signed out and on desktop, and never covers the last content
  - the language select appears in the top bar when signed out, on phones is only on Profile when signed in, and is in the top bar on desktop
  - amber appears only as a fill with dark text; no amber text on white
  - both themes are legible, including alerts and ghost buttons
  - the no-poster tiles show the film title

- [ ] **Step 5: Fix what is wrong, re-shoot the affected pages, and run the gates again:** `npx vitest run`, `npm run check`, `npm run lint`.

- [ ] **Step 6: Commit any fixes**

```bash
git add -A
git commit -m "style: fixes from the screenshot pass"
```

List the final PNG paths in the report, one per line, so the controller can show them to the user.
