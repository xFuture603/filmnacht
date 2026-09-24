<script lang="ts">
	import { t } from '$lib/i18n';
	let { data, form } = $props();
</script>

<h1 class="mb-4 text-2xl font-bold">{t(data.locale, 'profile.title')}</h1>

{#if form?.error}
	<div class="alert alert-error mb-4" role="alert">{t(data.locale, form.error)}</div>
{/if}
{#if form?.success}
	<div class="alert alert-success mb-4" role="alert">{t(data.locale, form.success)}</div>
{/if}

<h2 class="mb-1 text-lg font-semibold">{t(data.locale, 'auth.username')}</h2>
<p class="mb-1">{data.username}</p>
<p class="mb-8 text-sm opacity-70">{t(data.locale, 'profile.username_fixed')}</p>

<h2 class="mb-2 text-lg font-semibold">{t(data.locale, 'profile.display_name_heading')}</h2>
<form method="POST" action="?/changeDisplayName" class="mb-8 flex flex-col gap-2">
	<label class="form-control">
		<span class="label-text">{t(data.locale, 'auth.display_name')}</span>
		<input
			name="displayName"
			required
			maxlength="60"
			autocomplete="nickname"
			value={data.displayName}
			class="input input-bordered min-h-11"
		/>
		<span class="label-text-alt">{t(data.locale, 'auth.display_name_hint')}</span>
	</label>
	<button class="btn btn-primary min-h-11 self-start"
		>{t(data.locale, 'profile.save_display_name')}</button
	>
</form>

<h2 class="mb-2 text-lg font-semibold">{t(data.locale, 'profile.email')}</h2>
<form method="POST" action="?/setEmail" class="mb-8 flex flex-col gap-2">
	<label class="form-control">
		<span class="label-text">{t(data.locale, 'profile.email')}</span>
		<!-- Not required: leaving it empty is how you clear it. -->
		<input
			name="email"
			type="email"
			maxlength="254"
			autocomplete="email"
			value={data.email ?? ''}
			class="input input-bordered min-h-11"
		/>
		<span class="label-text-alt">{t(data.locale, 'profile.email_hint')}</span>
	</label>
	<button class="btn btn-primary min-h-11 self-start">{t(data.locale, 'profile.save_email')}</button
	>
</form>

<h2 class="mb-2 text-lg font-semibold">{t(data.locale, 'profile.change_password')}</h2>
<form method="POST" action="?/changePassword" class="mb-8 flex flex-col gap-2">
	<label class="form-control">
		<span class="label-text">{t(data.locale, 'profile.current_password')}</span>
		<!-- No minlength: an account may predate a bound change, and a client-side
		     rule that disagrees with the server only ever locks someone out. -->
		<input
			name="currentPassword"
			type="password"
			required
			autocomplete="current-password"
			class="input input-bordered min-h-11"
		/>
	</label>
	<label class="form-control">
		<span class="label-text">{t(data.locale, 'profile.new_password')}</span>
		<input
			name="newPassword"
			type="password"
			required
			minlength="8"
			maxlength="200"
			autocomplete="new-password"
			class="input input-bordered min-h-11"
		/>
		<span class="label-text-alt">{t(data.locale, 'auth.password_hint')}</span>
	</label>
	<label class="form-control">
		<span class="label-text">{t(data.locale, 'auth.password_repeat')}</span>
		<input
			name="passwordRepeat"
			type="password"
			required
			minlength="8"
			maxlength="200"
			autocomplete="new-password"
			class="input input-bordered min-h-11"
		/>
	</label>
	<button class="btn btn-primary min-h-11 self-start"
		>{t(data.locale, 'profile.change_password')}</button
	>
</form>

<h2 class="mb-1 text-lg font-semibold">{t(data.locale, 'profile.login_link')}</h2>
<p class="mb-2 text-sm">{t(data.locale, 'profile.login_link_hint')}</p>
<p class="mb-3 text-sm opacity-70">{t(data.locale, 'profile.reveal_warning')}</p>

<form method="POST" action="?/reveal">
	<button class="btn btn-secondary min-h-11">{t(data.locale, 'profile.reveal')}</button>
</form>

{#if form?.loginUrl}
	<label class="form-control mt-3">
		<span class="label-text">{t(data.locale, 'profile.login_link')}</span>
		<input class="input input-bordered min-h-11 w-full" readonly value={form.loginUrl} />
	</label>
{/if}

<form method="POST" action="/logout" class="mt-8">
	<button class="btn btn-ghost min-h-11">{t(data.locale, 'profile.logout')}</button>
</form>
