<script lang="ts">
	import { t } from '$lib/i18n';
	let { data, form } = $props();
</script>

<h1 class="mb-4 text-2xl font-bold">{t(data.locale, 'reset.choose_title')}</h1>

{#if form?.error}
	<div class="alert alert-error mb-4" role="alert">{t(data.locale, form.error)}</div>
{/if}

<form method="POST" class="flex flex-col gap-3">
	<label class="form-control">
		<span class="label-text">{t(data.locale, 'auth.password')}</span>
		<input
			name="password"
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
		>{t(data.locale, 'reset.choose_submit')}</button
	>
</form>

<!-- Said before the button is pressed, not after: the action redirects on
     success, so there is no page left to read it on. -->
<p class="mt-4 text-sm">{t(data.locale, 'reset.choose_hint')}</p>
