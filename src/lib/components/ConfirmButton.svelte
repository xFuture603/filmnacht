<script lang="ts">
	import type { Snippet } from 'svelte';

	/**
	 * The submit button for an irreversible action: one click arms it ("Click
	 * again to confirm"), the next sends `confirm=on`, which the server requires.
	 * Left alone it disarms after a few seconds. Without JavaScript the first
	 * click reaches the server, which answers `{ confirm: <action> }`, and the
	 * page renders this button with `armed` already set.
	 */
	let {
		armed: armedByServer = false,
		armedLabel,
		class: className = '',
		children
	}: { armed?: boolean; armedLabel: string; class?: string; children: Snippet } = $props();

	let clicked = $state(false);
	let timer: ReturnType<typeof setTimeout> | undefined;
	const armed = $derived(armedByServer || clicked);

	function onclick(event: MouseEvent) {
		if (armed) return; // the second click: let the form submit
		event.preventDefault();
		clicked = true;
		clearTimeout(timer);
		timer = setTimeout(() => (clicked = false), 5000);
	}

	$effect(() => () => clearTimeout(timer));
</script>

{#if armed}<input type="hidden" name="confirm" value="on" />{/if}
<button {onclick} class={[className, armed && 'btn-warning']}>
	<span aria-live="polite" class="inline-flex items-center gap-1">
		{#if armed}{armedLabel}{:else}{@render children()}{/if}
	</span>
</button>
