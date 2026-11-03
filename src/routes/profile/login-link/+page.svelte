<script lang="ts">
	import { t } from '$lib/i18n';
	import CopyField from '$lib/components/CopyField.svelte';
	import Field from '$lib/components/Field.svelte';
	import SubPage from '$lib/components/SubPage.svelte';
	let { data, form } = $props();
</script>

<SubPage
	locale={data.locale}
	back={{ href: '/profile', label: t(data.locale, 'profile.title') }}
	title={t(data.locale, 'profile.login_link')}
	{form}
	required={!form?.loginUrl}
>
	{#snippet intro()}
		<p class="mb-2 max-w-prose">{t(data.locale, 'profile.login_link_hint')}</p>
		<p class="mb-4 max-w-prose text-sm text-base-content/70">
			{t(data.locale, 'profile.reveal_warning')}
		</p>
	{/snippet}

	{#if form?.loginUrl}
		<!-- Shown once: only its hash is stored, so this is the moment to save it. -->
		<div class="mb-6 flex flex-col gap-1">
			<p class="text-sm font-bold">{t(data.locale, 'profile.login_link')}</p>
			<CopyField
				value={form.loginUrl}
				label={t(data.locale, 'profile.login_link')}
				copyLabel={t(data.locale, 'common.copy')}
				copiedLabel={t(data.locale, 'common.copied')}
			/>
		</div>
	{:else}
		<form method="POST" action="?/reveal" class="mb-6 flex flex-col gap-6">
			<Field label={t(data.locale, 'profile.current_password')}>
				<!-- Same proof changePassword demands, and for a stronger credential: the
				     link is permanent, reusable, and outlives logout and session expiry.
				     No minlength, for the same reason as changePassword. -->
				<input
					name="currentPassword"
					type="password"
					required
					autocomplete="current-password"
					class="input min-h-12 w-full"
				/>
			</Field>
			<button class="btn btn-primary min-h-12 w-full sm:w-auto sm:self-start"
				>{t(data.locale, 'profile.reveal')}</button
			>
		</form>
	{/if}
</SubPage>
