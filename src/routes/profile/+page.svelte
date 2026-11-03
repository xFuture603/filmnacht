<script lang="ts">
	import { enhance } from '$app/forms';
	import { t } from '$lib/i18n';
	import Toast from '$lib/components/Toast.svelte';
	import PageHeader from '$lib/components/PageHeader.svelte';
	import LocaleSelect from '$lib/components/LocaleSelect.svelte';
	import { ChevronRight } from '@lucide/svelte';
	import { footer, group, header, link, row } from '$lib/grouped-list';
	let { data, form } = $props();

	// Each row that edits something opens its own page with one button.
	// The first character as a reader sees it: a whole emoji, flag or accented
	// letter, never half of one.
	const initial = $derived(
		(
			new Intl.Segmenter().segment(data.displayName)[Symbol.iterator]().next().value?.segment ?? ''
		).toUpperCase()
	);

	const rows = $derived([
		{
			href: '/profile/name',
			label: t(data.locale, 'profile.display_name_heading'),
			value: data.displayName
		},
		{
			href: '/profile/email',
			label: t(data.locale, 'profile.email'),
			value: data.email ?? t(data.locale, 'profile.email_none')
		},
		{ href: '/profile/password', label: t(data.locale, 'auth.password') },
		{ href: '/profile/login-link', label: t(data.locale, 'profile.login_link') }
	]);
</script>

<PageHeader title={t(data.locale, 'profile.title')} />

{#if form?.error}
	<div class="alert alert-error alert-soft mb-4" role="alert">{t(data.locale, form.error)}</div>
{/if}
{#key form}
	{#if form?.success}<Toast message={t(data.locale, form.success)} locale={data.locale} />{/if}
{/key}

<!-- Who you are, before what you can change. -->
<div class="mb-8 flex items-center gap-4 px-4">
	<span
		class="grid size-16 shrink-0 place-items-center rounded-full bg-neutral text-2xl font-bold text-neutral-content"
		aria-hidden="true">{initial}</span
	>
	<div class="min-w-0">
		<p class="text-xl font-bold break-words">{data.displayName}</p>
		<p class="text-sm break-words text-base-content/70">
			{t(data.locale, 'profile.signs_in_as', { username: data.username })}
		</p>
	</div>
</div>

<section class="mb-8" aria-labelledby="profile-account">
	<h2 id="profile-account" class={header}>{t(data.locale, 'profile.account')}</h2>
	<ul class={group}>
		{#each rows as r (r.href)}
			<li>
				<a href={r.href} class={link}>
					<span class="shrink-0">{r.label}</span>
					<span class="ms-auto min-w-0 truncate text-base-content/70">{r.value ?? ''}</span>
					<ChevronRight class="size-4 shrink-0 text-base-content/50" strokeWidth={2.5} />
				</a>
			</li>
		{/each}
	</ul>
</section>

<section class="mb-8" aria-labelledby="profile-emails">
	<h2 id="profile-emails" class={header}>{t(data.locale, 'profile.emails')}</h2>
	<!-- A switch applies when flipped, as in iOS; the button is only there
	     without JavaScript. reset: false keeps the switches as they were set. -->
	<form
		method="POST"
		action="?/setMailPrefs"
		use:enhance={() =>
			({ update }) =>
				update({ reset: false })}
	>
		<div class={group}>
			<label class="{row} cursor-pointer">
				<span class="min-w-0 flex-1">{t(data.locale, 'profile.rating_mails')}</span>
				<input
					type="checkbox"
					name="ratingMails"
					checked={data.ratingMails}
					onchange={(e) => e.currentTarget.form?.requestSubmit()}
					class="toggle shrink-0"
				/>
			</label>
			<label class="{row} cursor-pointer">
				<span class="min-w-0 flex-1">{t(data.locale, 'profile.night_mails')}</span>
				<input
					type="checkbox"
					name="nightMails"
					checked={data.nightMails}
					onchange={(e) => e.currentTarget.form?.requestSubmit()}
					class="toggle shrink-0"
				/>
			</label>
		</div>
		<p class={footer}>{t(data.locale, 'profile.mail_prefs_hint')}</p>
		<noscript>
			<button class="btn btn-outline mt-2 min-h-12"
				>{t(data.locale, 'profile.save_mail_prefs')}</button
			>
		</noscript>
	</form>
</section>

<!-- Phones only: the top bar carries the language select from md upwards. -->
<section class="mb-8 md:hidden" aria-label={t(data.locale, 'nav.language')}>
	<div class="{row} rounded-box bg-base-100 py-1">
		<span>{t(data.locale, 'nav.language')}</span>
		<LocaleSelect locale={data.locale} pathname="/profile" class="ms-auto" />
	</div>
</section>

<form method="POST" action="/logout" class="mb-8">
	<button class="{link} justify-center rounded-box bg-base-100 font-bold text-error"
		>{t(data.locale, 'profile.logout')}</button
	>
</form>
