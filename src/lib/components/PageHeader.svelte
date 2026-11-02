<script lang="ts">
	import type { Component, Snippet } from 'svelte';
	let {
		title,
		subtitle,
		subtitleIcon: SubtitleIcon,
		byline,
		action
	}: {
		title: string;
		subtitle?: string;
		subtitleIcon?: Component;
		/** A second quiet line under the subtitle, such as who organized a night. */
		byline?: string;
		action?: Snippet;
	} = $props();
</script>

<svelte:head><title>{title} · Filmnacht</title></svelte:head>

<header class="mb-6 flex flex-wrap items-end justify-between gap-3 pt-2">
	<div class="min-w-0">
		<!-- An iOS large title: 34px bold, no decoration beside it. A step smaller on
		     phones, where a long German title would otherwise take five lines. -->
		<h1 class="text-3xl leading-tight font-bold break-words sm:text-[2.125rem]">
			{title}
		</h1>
		{#if subtitle}
			<p class="mt-1 flex items-center gap-1 text-sm text-base-content/70">
				{#if SubtitleIcon}<SubtitleIcon class="size-4 shrink-0" />{/if}
				<span class="min-w-0 break-words">{subtitle}</span>
			</p>
		{/if}
		{#if byline}
			<p class="mt-1 text-sm break-words text-base-content/70">{byline}</p>
		{/if}
	</div>
	{#if action}{@render action()}{/if}
</header>
