<script lang="ts">
	import type { Snippet } from 'svelte';
	let { label, hint, children }: { label: string; hint?: string; children: Snippet } = $props();
</script>

<!-- The wrapping <label> keeps the accessible name exactly as the pages had it.
     `fieldset` / `fieldset-legend` / `label` are daisyUI 5's own names for
     this layout; the daisyUI 4 class names for it no longer exist and render as nothing. -->
<!-- The hint sits above the control (Practical UI): read before typing, not after.
     A required control gets an asterisk from app.css. -->
<label class="fieldset">
	<span class="fieldset-legend text-sm">{label}</span>
	{#if hint}<span class="label text-xs whitespace-normal">{hint}</span>{/if}
	{@render children()}
</label>
