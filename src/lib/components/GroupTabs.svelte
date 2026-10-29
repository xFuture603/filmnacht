<script lang="ts">
	import type { Component } from 'svelte';
	import { CalendarDays, Clapperboard, Settings } from '@lucide/svelte';
	import { t, type Locale } from '$lib/i18n';
	let {
		groupId,
		groupName,
		active,
		locale,
		isOwner = false,
		counts = { pool: 0, nights: 0 }
	}: {
		groupId: string;
		groupName: string;
		active: 'pool' | 'nights' | 'settings';
		locale: Locale;
		isOwner?: boolean;
		counts?: { pool: number; nights: number };
	} = $props();
	type Tab = { id: 'pool' | 'nights' | 'settings'; href: string; label: string; icon: Component };
	const tabs = $derived([
		{ id: 'pool', href: `/groups/${groupId}`, label: t(locale, 'pool.title'), icon: Clapperboard },
		{
			id: 'nights',
			href: `/groups/${groupId}/nights`,
			label: t(locale, 'nights.title'),
			icon: CalendarDays
		},
		// Owner-only: a member has nothing to configure here.
		...(isOwner
			? [
					{
						id: 'settings',
						href: `/groups/${groupId}/settings`,
						label: t(locale, 'settings.tab'),
						icon: Settings
					} as const
				]
			: [])
	] satisfies Tab[]);
</script>

<!-- Links, not ARIA tabs: each is its own page and works without JavaScript. -->
<!-- Labelled with the group's name, not "Main navigation": this is the
     group's own sections, and one page must not carry two identical landmarks. -->
<nav class="tabs tabs-box mb-6 w-full flex-nowrap bg-secondary p-1 sm:w-fit" aria-label={groupName}>
	{#each tabs as tab (tab.id)}
		<a
			class={[
				// On phones a new-count badge stacks under its label: side by side they
				// do not fit three tabs into 320px.
				'tab min-h-12 flex-1 gap-2 px-2 whitespace-nowrap max-sm:h-auto max-sm:flex-col max-sm:gap-0.5 max-sm:py-1 sm:flex-none sm:px-4',
				tab.id === active && 'tab-active'
			]}
			href={tab.href}
			data-sveltekit-preload-data="off"
			aria-current={tab.id === active ? 'page' : undefined}
		>
			<tab.icon class="size-4 max-sm:hidden" />{tab.label}
			{#if tab.id !== 'settings' && counts[tab.id] > 0}
				<span class="badge badge-sm badge-neutral" aria-hidden="true">{counts[tab.id]}</span>
				<span class="sr-only">{t(locale, 'new.count', { count: counts[tab.id] })}</span>
			{/if}
		</a>
	{/each}
</nav>
