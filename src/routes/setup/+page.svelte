<script lang="ts">
	import { t } from '$lib/i18n';
	let { data, form } = $props();
</script>

<h1 class="mb-2 text-2xl font-bold">{t(data.locale, 'setup.title')}</h1>
<p class="mb-4">{t(data.locale, 'setup.intro')}</p>

{#if form?.error}
	<div class="alert alert-error mb-4" role="alert">{t(data.locale, form.error)}</div>
{/if}

<form method="POST" class="flex flex-col gap-4">
	<label class="form-control">
		<span class="label-text">{t(data.locale, 'auth.username')}</span>
		<input
			name="username"
			required
			minlength="3"
			maxlength="32"
			autocomplete="username"
			class="input input-bordered min-h-11"
		/>
		<span class="label-text-alt">{t(data.locale, 'auth.username_hint')}</span>
	</label>

	<label class="form-control">
		<span class="label-text">{t(data.locale, 'auth.display_name')}</span>
		<input
			name="displayName"
			required
			maxlength="60"
			autocomplete="nickname"
			class="input input-bordered min-h-11"
		/>
		<span class="label-text-alt">{t(data.locale, 'auth.display_name_hint')}</span>
	</label>

	<label class="form-control">
		<span class="label-text">{t(data.locale, 'auth.password')}</span>
		<input
			name="password"
			type="password"
			required
			minlength="8"
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
			autocomplete="new-password"
			class="input input-bordered min-h-11"
		/>
	</label>

	<label class="form-control">
		<span class="label-text">{t(data.locale, 'setup.timezone')}</span>
		<select name="timezone" required class="select select-bordered min-h-11">
			{#each data.timezones as tz (tz)}
				<option value={tz} selected={tz === 'Europe/Berlin'}>{tz}</option>
			{/each}
		</select>
	</label>

	<button class="btn btn-primary min-h-11">{t(data.locale, 'setup.submit')}</button>
</form>
