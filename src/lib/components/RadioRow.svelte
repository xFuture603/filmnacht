<script lang="ts">
	/**
	 * A handful of options as visible radio buttons, one click each, instead of a
	 * dropdown (Practical UI). Native radios: keyboard and no-JS work as usual.
	 * A <fieldset>, not Field: a <label> may wrap only one control.
	 */
	let {
		legend,
		name,
		options,
		value
	}: {
		legend: string;
		name: string;
		options: { value: string | number; label: string }[];
		value: string | number;
	} = $props();
</script>

<fieldset class="fieldset">
	<legend class="fieldset-legend text-sm">{legend}</legend>
	<!-- Separate buttons, not a joined bar: on a phone they wrap cleanly. -->
	<div class="flex flex-wrap gap-2">
		{#each options as option (option.value)}
			<input
				class="btn min-h-11"
				type="radio"
				{name}
				value={option.value}
				aria-label={option.label}
				checked={option.value === value}
			/>
		{/each}
	</div>
</fieldset>
