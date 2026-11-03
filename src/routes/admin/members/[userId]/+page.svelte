<script lang="ts">
	import { t } from '$lib/i18n';
	import CopyField from '$lib/components/CopyField.svelte';
	import Field from '$lib/components/Field.svelte';
	import SubPage from '$lib/components/SubPage.svelte';
	let { data, form } = $props();
</script>

<SubPage
	locale={data.locale}
	back={{ href: '/admin/members', label: t(data.locale, 'admin.accounts') }}
	title={data.member.displayName}
	subtitle={data.member.username}
	{form}
	required={!form?.recoveryUrl}
>
	{#snippet intro()}
		{#if !form?.recoveryUrl}
			<p class="mb-4 max-w-prose">{t(data.locale, 'admin.recover_hint')}</p>
		{/if}
	{/snippet}
	{#if form?.recoveryUrl}
		<div class="alert alert-success alert-soft mb-2" role="alert">
			{t(data.locale, 'admin.recovered', { name: form.recoveredName })}
		</div>
		<!-- The one thing here that has to be copied, often on a phone. -->
		<div class="mb-6">
			<CopyField
				value={form.recoveryUrl}
				label={t(data.locale, 'admin.recovery_link_label')}
				copyLabel={t(data.locale, 'common.copy')}
				copiedLabel={t(data.locale, 'common.copied')}
			/>
		</div>
	{:else}
		<form method="POST" action="?/recover" class="mb-6 flex flex-col gap-6">
			<input type="hidden" name="userId" value={data.member.id} />
			<Field label={t(data.locale, 'admin.recover_password')}>
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
			<button class="btn btn-primary min-h-12 w-full sm:w-auto sm:self-start"
				>{t(data.locale, 'admin.recover')}</button
			>
		</form>
	{/if}
</SubPage>
