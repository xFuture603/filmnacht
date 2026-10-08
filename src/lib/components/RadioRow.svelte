<script lang="ts">
	/**
	 * A handful of options as visible radio buttons, one click each, instead of a
	 * dropdown (Practical UI). Conventional radios with the circle on the left:
	 * styled as buttons they read as actions, or as more than one choice.
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
	{#each options as option (option.value)}
		<!-- The whole row is the 48px target, not just the circle. -->
		<label class="flex min-h-12 cursor-pointer items-center gap-3 text-base">
			<input
				class="radio"
				type="radio"
				{name}
				value={option.value}
				checked={option.value === value}
			/><span>{option.label}</span>
		</label>
	{/each}
</fieldset>
