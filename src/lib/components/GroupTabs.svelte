<script lang="ts">
	import { CalendarDays, Clapperboard } from '@lucide/svelte';
	import { t, type Locale } from '$lib/i18n';
	let {
		groupId,
		groupName,
		active,
		locale
	}: { groupId: string; groupName: string; active: 'pool' | 'nights'; locale: Locale } = $props();
	const tabs = $derived([
		{ id: 'pool', href: `/groups/${groupId}`, label: t(locale, 'pool.title'), icon: Clapperboard },
		{
			id: 'nights',
			href: `/groups/${groupId}/nights`,
			label: t(locale, 'nights.title'),
			icon: CalendarDays
		}
	] as const);
</script>

<!-- Links, not ARIA tabs: each is its own page and works without JavaScript. -->
<!-- Labelled with the group's name, not "Main navigation": this is the
     group's own sections, and one page must not carry two identical landmarks. -->
<nav class="tabs tabs-box mb-6 w-fit bg-base-300" aria-label={groupName}>
	{#each tabs as tab (tab.id)}
		<a
			class={['tab min-h-11 gap-2', tab.id === active && 'tab-active']}
			href={tab.href}
			aria-current={tab.id === active ? 'page' : undefined}
		>
			<tab.icon class="size-4" />{tab.label}
		</a>
	{/each}
</nav>
