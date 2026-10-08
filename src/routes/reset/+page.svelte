<script lang="ts">
	import RequiredNote from '$lib/components/RequiredNote.svelte';
	import { t } from '$lib/i18n';
	import FormCard from '$lib/components/FormCard.svelte';
	import Field from '$lib/components/Field.svelte';
	let { data, form } = $props();
</script>

<FormCard title={t(data.locale, 'reset.title')}>
	{#if form?.error}
		<div class="alert alert-error alert-soft" role="alert">{t(data.locale, form.error)}</div>
	{/if}
	{#if form?.success}
		<div class="alert alert-success alert-soft" role="alert">{t(data.locale, form.success)}</div>
	{/if}

	{#if data.mailConfigured}
		<form method="POST" class="flex flex-col gap-2">
			<RequiredNote locale={data.locale} />
			<Field label={t(data.locale, 'reset.email')}>
				<input
					name="email"
					type="email"
					required
					maxlength="254"
					autocomplete="email"
					class="input min-h-11 w-full"
				/>
			</Field>

			<button class="btn btn-primary mt-2 min-h-11 w-full">{t(data.locale, 'reset.submit')}</button>
		</form>
	{:else}
		<!-- No form at all: this instance has nothing to send, and a form that
		     accepted an address and then said nothing useful would be a worse lie
		     than saying so plainly. The action still answers identically if one is
		     submitted anyway. -->
		<p class="text-base-content/70">{t(data.locale, 'reset.no_mail')}</p>
	{/if}
</FormCard>
