<script lang="ts">
	import type { Snippet } from 'svelte';
	let {
		title,
		emoji = null,
		subtitle,
		action
	}: { title: string; emoji?: string | null; subtitle?: string; action?: Snippet } = $props();
</script>

<header class="mb-6 flex flex-wrap items-end justify-between gap-3">
	<div class="min-w-0">
		<h1 class="text-2xl font-bold tracking-tight break-words">
			{#if emoji}<span aria-hidden="true" class="mr-1">{emoji}</span>{/if}{title}
		</h1>
		{#if subtitle}<p class="mt-1 text-sm text-base-content/70">{subtitle}</p>{/if}
	</div>
	{#if action}{@render action()}{/if}
</header>
