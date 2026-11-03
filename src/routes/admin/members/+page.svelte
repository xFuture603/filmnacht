<script lang="ts">
	import { t } from '$lib/i18n';
	import SubPage from '$lib/components/SubPage.svelte';
	import { footer, group, link } from '$lib/grouped-list';
	import { ChevronRight } from '@lucide/svelte';
	let { data } = $props();
</script>

<SubPage
	locale={data.locale}
	back={{ href: '/admin', label: t(data.locale, 'nav.admin') }}
	title={t(data.locale, 'admin.accounts')}
	form={null}
	required={false}
>
	<ul class={group}>
		{#each data.members as member (member.id)}
			<li>
				<a href="/admin/members/{member.id}" class={link}>
					<span class="min-w-0 flex-1">
						<span class="block break-words">{member.displayName}</span>
						<span class="block text-sm break-words text-base-content/70">{member.username}</span>
					</span>
					<ChevronRight class="size-4 shrink-0 text-base-content/50" strokeWidth={2.5} />
				</a>
			</li>
		{/each}
	</ul>
	<p class="{footer} mb-8">{t(data.locale, 'admin.members_hint')}</p>
</SubPage>
