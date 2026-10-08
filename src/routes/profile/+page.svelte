<script lang="ts">
	import RequiredNote from '$lib/components/RequiredNote.svelte';
	import { t } from '$lib/i18n';
	import Toast from '$lib/components/Toast.svelte';
	import PageHeader from '$lib/components/PageHeader.svelte';
	import Field from '$lib/components/Field.svelte';
	import LocaleSelect from '$lib/components/LocaleSelect.svelte';
	let { data, form } = $props();

	const card = 'card mb-4 border border-base-300 bg-base-100 shadow-sm';
	// Several equal forms on one page: secondary buttons, no single primary.
	const submit = 'btn btn-outline mt-2 min-h-12 w-full sm:w-auto sm:self-start';
</script>

<PageHeader title={t(data.locale, 'profile.title')} />
<div class="mb-4"><RequiredNote locale={data.locale} /></div>

{#if form?.error}
	<div class="alert alert-error alert-soft mb-4" role="alert">{t(data.locale, form.error)}</div>
{/if}
{#key form}
	{#if form?.success}<Toast message={t(data.locale, form.success)} locale={data.locale} />{/if}
{/key}

<section class={card}>
	<div class="card-body gap-1">
		<h2 class="card-title text-lg">{t(data.locale, 'auth.username')}</h2>
		<p class="font-mono">{data.username}</p>
		<p class="text-sm text-base-content/70">{t(data.locale, 'profile.username_fixed')}</p>
	</div>
</section>

<section class={card}>
	<div class="card-body">
		<h2 class="card-title text-lg">{t(data.locale, 'profile.display_name_heading')}</h2>
		<form method="POST" action="?/changeDisplayName" class="flex flex-col gap-2">
			<Field
				label={t(data.locale, 'auth.display_name')}
				hint={t(data.locale, 'auth.display_name_hint')}
			>
				<input
					name="displayName"
					required
					maxlength="60"
					autocomplete="nickname"
					value={data.displayName}
					class="input min-h-12 w-full"
				/>
			</Field>
			<button class={submit}>{t(data.locale, 'profile.save_display_name')}</button>
		</form>
	</div>
</section>

<section class={card}>
	<div class="card-body">
		<h2 class="card-title text-lg">{t(data.locale, 'profile.email')}</h2>
		<form method="POST" action="?/setEmail" class="flex flex-col gap-2">
			<Field
				label={t(data.locale, 'profile.email_label')}
				hint={t(data.locale, 'profile.email_hint')}
			>
				<!-- Not required: leaving it empty is how you clear it. -->
				<input
					name="email"
					type="email"
					maxlength="254"
					autocomplete="email"
					value={data.email ?? ''}
					class="input min-h-12 w-full"
				/>
			</Field>
			<button class={submit}>{t(data.locale, 'profile.save_email')}</button>
		</form>
		<form method="POST" action="?/setMailPrefs" class="mt-4 flex flex-col gap-1">
			<label class="flex min-h-12 cursor-pointer items-center gap-3">
				<input type="checkbox" name="ratingMails" checked={data.ratingMails} class="toggle" />
				<span>{t(data.locale, 'profile.rating_mails')}</span>
			</label>
			<label class="flex min-h-12 cursor-pointer items-center gap-3">
				<input type="checkbox" name="nightMails" checked={data.nightMails} class="toggle" />
				<span>{t(data.locale, 'profile.night_mails')}</span>
			</label>
			<p class="text-sm text-base-content/70">{t(data.locale, 'profile.mail_prefs_hint')}</p>
			<button class={submit}>{t(data.locale, 'profile.save_mail_prefs')}</button>
		</form>
	</div>
</section>

<section class={card}>
	<div class="card-body">
		<h2 class="card-title text-lg">{t(data.locale, 'profile.change_password')}</h2>
		<form method="POST" action="?/changePassword" class="flex flex-col gap-2">
			<Field label={t(data.locale, 'profile.current_password')}>
				<!-- No minlength: an account may predate a bound change, and a client-side
				     rule that disagrees with the server only ever locks someone out. -->
				<input
					name="currentPassword"
					type="password"
					required
					autocomplete="current-password"
					class="input min-h-12 w-full"
				/>
			</Field>
			<Field
				label={t(data.locale, 'profile.new_password')}
				hint={t(data.locale, 'auth.password_hint')}
			>
				<input
					name="newPassword"
					type="password"
					required
					minlength="8"
					maxlength="200"
					autocomplete="new-password"
					class="input min-h-12 w-full"
				/>
			</Field>
			<Field label={t(data.locale, 'auth.password_repeat')}>
				<input
					name="passwordRepeat"
					type="password"
					required
					minlength="8"
					maxlength="200"
					autocomplete="new-password"
					class="input min-h-12 w-full"
				/>
			</Field>
			<button class={submit}>{t(data.locale, 'profile.change_password')}</button>
		</form>
	</div>
</section>

<section class={card}>
	<div class="card-body">
		<h2 class="card-title text-lg">{t(data.locale, 'profile.login_link')}</h2>
		<p class="text-sm">{t(data.locale, 'profile.login_link_hint')}</p>
		<p class="text-sm text-base-content/70">{t(data.locale, 'profile.reveal_warning')}</p>

		<form method="POST" action="?/reveal" class="flex flex-col gap-2">
			<Field label={t(data.locale, 'profile.current_password')}>
				<!-- Same proof changePassword demands, and for a stronger credential: the
				     link is permanent, reusable, and outlives logout and session expiry.
				     aria-label rather than the bare visible text, because this page now has
				     two "Current password" inputs and repeated controls need distinct
				     accessible names. No minlength, for the same reason as changePassword. -->
				<input
					name="currentPassword"
					type="password"
					required
					autocomplete="current-password"
					aria-label={t(data.locale, 'profile.reveal_password')}
					class="input min-h-12 w-full"
				/>
			</Field>
			<button class="btn btn-outline mt-2 min-h-12 w-full sm:w-auto sm:self-start"
				>{t(data.locale, 'profile.reveal')}</button
			>
		</form>

		{#if form?.loginUrl}
			<Field label={t(data.locale, 'profile.login_link')}>
				<input class="input min-h-12 w-full font-mono text-sm" readonly value={form.loginUrl} />
			</Field>
		{/if}
	</div>
</section>

<!-- Phones only: the top bar carries the language select from md upwards. -->
<section class="{card} md:hidden">
	<div class="card-body">
		<h2 class="card-title text-lg">{t(data.locale, 'nav.language')}</h2>
		<LocaleSelect locale={data.locale} pathname="/profile" />
	</div>
</section>

<form method="POST" action="/logout" class="mt-6">
	<button class="btn btn-ghost min-h-12 w-full sm:w-auto">{t(data.locale, 'profile.logout')}</button
	>
</form>
