<script lang="ts">
	import type { Snippet } from 'svelte';
	import Icon, { type IconName } from './Icon.svelte';
	let { icon, text, action }: { icon: IconName; text: string; action?: Snippet } = $props();
</script>

<div
	class="flex flex-col items-center gap-3 rounded-box border border-dashed border-base-300 bg-base-100 px-6 py-10 text-center"
>
	<Icon name={icon} class="size-10 text-base-content/40" />
	<p class="text-base-content/70">{text}</p>
	{#if action}{@render action()}{/if}
</div>
