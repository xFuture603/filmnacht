<script lang="ts">
	import { t } from '$lib/i18n';
	import FormCard from '$lib/components/FormCard.svelte';
	import Field from '$lib/components/Field.svelte';
	let { data, form } = $props();
</script>

<FormCard title={t(data.locale, 'reset.choose_title')}>
	{#if form?.error}
		<div class="alert alert-error alert-soft" role="alert">{t(data.locale, form.error)}</div>
	{/if}

	<form method="POST" class="flex flex-col gap-2">
		<Field label={t(data.locale, 'auth.password')} hint={t(data.locale, 'auth.password_hint')}>
			<input
				name="password"
				type="password"
				required
				minlength="8"
				maxlength="200"
				autocomplete="new-password"
				class="input min-h-11 w-full"
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
				class="input min-h-11 w-full"
			/>
		</Field>

		<button class="btn btn-primary mt-2 min-h-11 w-full"
			>{t(data.locale, 'reset.choose_submit')}</button
		>
	</form>

	<!-- Said before the button is pressed, not after: the action redirects on
	     success, so there is no page left to read it on. -->
	<p class="text-sm text-base-content/70">{t(data.locale, 'reset.choose_hint')}</p>
</FormCard>
