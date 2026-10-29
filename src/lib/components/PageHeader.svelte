<script lang="ts">
	import type { Component, Snippet } from 'svelte';
	let {
		title,
		subtitle,
		subtitleIcon: SubtitleIcon,
		action
	}: {
		title: string;
		subtitle?: string;
		subtitleIcon?: Component;
		action?: Snippet;
	} = $props();
</script>

<svelte:head><title>{title} · Filmnacht</title></svelte:head>

<header class="mb-6 flex flex-wrap items-end justify-between gap-3 pt-2">
	<div class="min-w-0">
		<!-- An iOS large title: 34px bold, no decoration beside it. -->
		<h1 class="text-[2.125rem] leading-tight font-bold break-words">{title}</h1>
		{#if subtitle}
			<p class="mt-1 flex items-center gap-1 text-sm text-base-content/70">
				{#if SubtitleIcon}<SubtitleIcon class="size-4 shrink-0" />{/if}
				<span class="min-w-0 break-words">{subtitle}</span>
			</p>
		{/if}
	</div>
	{#if action}{@render action()}{/if}
</header>
