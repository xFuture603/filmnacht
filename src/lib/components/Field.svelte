<script lang="ts">
	import type { Snippet } from 'svelte';
	let { label, hint, children }: { label: string; hint?: string; children: Snippet } = $props();
</script>

<!-- The wrapping <label> keeps the accessible name exactly as the pages had it.
     `fieldset` / `fieldset-legend` / `label` are daisyUI 5's own names for
     this layout; the daisyUI 4 class names for it no longer exist and render as nothing. -->
<label class="fieldset">
	<span class="fieldset-legend text-sm">{label}</span>
	{@render children()}
	{#if hint}<span class="label text-xs whitespace-normal">{hint}</span>{/if}
</label>
