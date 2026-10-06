<script lang="ts">
	/**
	 * The Filmnacht mark: a retro TV, drawn for the amber tile in the header.
	 * Ink is currentColor; the screen glare is the amber of the tile behind it.
	 * static/favicon.svg draws the same shapes on its own tile — change both.
	 */
	let { class: className = '' }: { class?: string } = $props();
</script>

<svg
	class={className}
	viewBox="0 0 24 24"
	fill="none"
	stroke="currentColor"
	stroke-width="1.75"
	stroke-linecap="round"
	stroke-linejoin="round"
	aria-hidden="true"
>
	<path d="M12 7 8.25 3M12 7l3.75-4" />
	<circle cx="8" cy="2.75" r="0.75" fill="currentColor" />
	<circle cx="16" cy="2.75" r="0.75" fill="currentColor" />
	<rect x="2" y="7" width="20" height="13" rx="2.5" />
	<rect x="4.5" y="9.5" width="11" height="8" rx="1.75" fill="currentColor" />
	<path
		d="M6.75 12.25a1.75 1.75 0 0 1 1.75-1.25"
		style="stroke: var(--color-primary)"
		stroke-width="1.1"
	/>
	<circle cx="18.75" cy="11.5" r="1.1" />
	<circle cx="18.75" cy="14.75" r="0.65" fill="currentColor" stroke="none" />
	<path d="M17.75 17.25h2" stroke-width="1.25" />
	<path d="M6 20l-1 2M18 20l1 2" />
</svg>
