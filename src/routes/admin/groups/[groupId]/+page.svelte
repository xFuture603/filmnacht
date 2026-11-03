<script lang="ts">
	import { t } from '$lib/i18n';
	import Field from '$lib/components/Field.svelte';
	import SubPage from '$lib/components/SubPage.svelte';
	let { data, form } = $props();
</script>

<SubPage
	locale={data.locale}
	back={{ href: '/admin/groups', label: t(data.locale, 'admin.groups') }}
	title={data.group.name}
	subtitle={t(data.locale, 'admin.group_meta', {
		owner: data.group.owner,
		count: data.group.members
	})}
	{form}
>
	{#snippet intro()}
		<p class="mb-4 max-w-prose">{t(data.locale, 'settings.delete_hint')}</p>
	{/snippet}
	<!-- Typing the name, not ticking a box: this one cannot be undone. -->
	<form method="POST" action="?/deleteGroup" class="mb-6 flex flex-col gap-6">
		<input type="hidden" name="groupId" value={data.group.id} />
		<Field label={t(data.locale, 'settings.delete_label', { group: data.group.name })}>
			<input name="name" required autocomplete="off" class="input min-h-12 w-full" />
		</Field>
		<button class="btn btn-outline btn-error min-h-12 w-full sm:w-auto sm:self-start"
			>{t(data.locale, 'settings.delete')}</button
		>
	</form>
</SubPage>
