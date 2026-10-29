<script lang="ts">
	import type { Component, Snippet } from 'svelte';
	let {
		icon: EmptyIcon,
		text,
		action
	}: { icon: Component; text: string; action?: Snippet } = $props();
</script>

<div class="flex flex-col items-center gap-3 rounded-box bg-base-100 px-6 py-10 text-center">
	<!-- 48px with 1px strokes: twice the 24px grid, so lines land on whole pixels. -->
	<EmptyIcon class="size-12 text-base-content opacity-40" strokeWidth={1} />
	<p class="text-base-content/70">{text}</p>
	{#if action}{@render action()}{/if}
</div>
