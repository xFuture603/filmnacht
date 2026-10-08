<script lang="ts">
	import { onMount } from 'svelte';

	/**
	 * A link to hand on (invite, login, recovery): read-only, with a Copy button.
	 * `autoCopy` copies it the moment it appears, right after the click that made
	 * it. Browsers that refuse that (Safari, after a network round trip) still
	 * have the button, and clicking the field selects it all.
	 */
	let {
		value,
		label,
		copyLabel,
		copiedLabel,
		autoCopy = false
	}: {
		value: string;
		label: string;
		copyLabel: string;
		copiedLabel: string;
		autoCopy?: boolean;
	} = $props();

	let input: HTMLInputElement;
	let copied = $state(false);

	async function copy() {
		try {
			await navigator.clipboard.writeText(value);
			copied = true;
		} catch {
			input.select(); // no clipboard access: leave it ready for Ctrl+C
		}
	}

	onMount(() => {
		if (autoCopy) {
			navigator.clipboard
				?.writeText(value)
				.then(() => (copied = true))
				.catch(() => {});
		}
	});
</script>

<div class="join w-full">
	<input
		bind:this={input}
		class="input join-item min-h-12 w-full font-mono text-sm"
		readonly
		{value}
		aria-label={label}
		onfocus={(event) => event.currentTarget.select()}
	/>
	<button type="button" class="btn join-item min-h-12" onclick={copy}>
		<span aria-live="polite">{copied ? copiedLabel : copyLabel}</span>
	</button>
</div>
