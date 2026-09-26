<script lang="ts">
	import type { Component, Snippet } from 'svelte';
	let {
		icon: EmptyIcon,
		text,
		action
	}: { icon: Component; text: string; action?: Snippet } = $props();
</script>

<div
	class="flex flex-col items-center gap-3 rounded-box border border-dashed border-base-300 bg-base-100 px-6 py-10 text-center"
>
	<EmptyIcon class="size-10 text-base-content/40" strokeWidth={1.5} />
	<p class="text-base-content/70">{text}</p>
	{#if action}{@render action()}{/if}
</div>
