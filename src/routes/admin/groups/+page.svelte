<script lang="ts">
	import { t } from '$lib/i18n';
	import { page } from '$app/state';
	import SubPage from '$lib/components/SubPage.svelte';
	import Toast from '$lib/components/Toast.svelte';
	import { group, link, row } from '$lib/grouped-list';
	import { ChevronRight } from '@lucide/svelte';
	let { data } = $props();

	// Deleting happens on the group's own page, which is gone afterwards; it
	// sends the name back here to confirm.
	const deleted = $derived(page.url.searchParams.get('deleted'));
</script>

<SubPage
	locale={data.locale}
	back={{ href: '/admin', label: t(data.locale, 'nav.admin') }}
	title={t(data.locale, 'admin.groups')}
	form={null}
	required={false}
>
	{#if deleted}
		<Toast
			message={t(data.locale, 'admin.group_deleted', { group: deleted })}
			locale={data.locale}
		/>
	{/if}
	{#if data.groups.length === 0}
		<p class="{group} {row} mb-8 text-base-content/70">{t(data.locale, 'admin.groups_empty')}</p>
	{:else}
		<ul class="{group} mb-8">
			{#each data.groups as g (g.id)}
				<li>
					<a href="/admin/groups/{g.id}" class={link}>
						<span class="min-w-0 flex-1">
							<span class="block break-words">{g.name}</span>
							<span class="block text-sm text-base-content/70">
								{t(data.locale, 'admin.group_meta', { owner: g.owner, count: g.members })}
							</span>
						</span>
						<ChevronRight class="size-4 shrink-0 text-base-content/50" strokeWidth={2.5} />
					</a>
				</li>
			{/each}
		</ul>
	{/if}
</SubPage>
