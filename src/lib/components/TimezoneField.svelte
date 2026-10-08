<script lang="ts">
	import Field from './Field.svelte';

	/**
	 * Over 400 zones: a field with suggestions as you type (Practical UI:
	 * autocomplete instead of a long dropdown). A native <datalist>, so no
	 * script; the server still refuses anything not in the list.
	 */
	let {
		label,
		hint,
		timezones,
		value
	}: { label: string; hint?: string; timezones: readonly string[]; value: string } = $props();
</script>

<Field {label} {hint}>
	<input
		name="timezone"
		list="timezones"
		required
		autocomplete="off"
		spellcheck="false"
		{value}
		class="input min-h-12 w-full sm:w-80"
	/>
	<datalist id="timezones">
		{#each timezones as tz (tz)}
			<option value={tz}></option>
		{/each}
	</datalist>
</Field>
