<script lang="ts">
	import type { Component, Snippet } from 'svelte';
	let {
		title,
		icon: HeaderIcon,
		subtitle,
		subtitleIcon: SubtitleIcon,
		action
	}: {
		title: string;
		icon?: Component;
		subtitle?: string;
		subtitleIcon?: Component;
		action?: Snippet;
	} = $props();
</script>

<header class="mb-6 flex flex-wrap items-center justify-between gap-3">
	<div class="flex min-w-0 items-center gap-3">
		{#if HeaderIcon}
			<!-- A neutral tile, not amber: an amber glyph on a pale tile would be too
			     faint, and amber is kept for fills (see app.css). -->
			<span
				class="grid size-11 shrink-0 place-items-center rounded-field bg-base-100 text-base-content shadow-sm ring-1 ring-base-300"
			>
				<HeaderIcon class="size-5" />
			</span>
		{/if}
		<div class="min-w-0">
			<h1 class="text-2xl font-bold tracking-tight break-words">{title}</h1>
			{#if subtitle}
				<p class="mt-1 flex items-center gap-1 text-sm text-base-content/70">
					{#if SubtitleIcon}<SubtitleIcon class="size-4 shrink-0" />{/if}
					<span class="min-w-0 break-words">{subtitle}</span>
				</p>
			{/if}
		</div>
	</div>
	{#if action}{@render action()}{/if}
</header>
