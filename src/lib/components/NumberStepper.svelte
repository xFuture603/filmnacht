<script lang="ts">
	/**
	 * A small number with − and +, quicker than a dropdown of numbers.
	 * The field stays a plain number input, so typing works without JavaScript
	 * and the server keeps checking the range.
	 */
	let {
		legend,
		name,
		value,
		min,
		max,
		decreaseLabel,
		increaseLabel
	}: {
		legend: string;
		name: string;
		value: number;
		min: number;
		max: number;
		decreaseLabel: string;
		increaseLabel: string;
	} = $props();

	let input: HTMLInputElement;
</script>

<fieldset class="fieldset">
	<legend class="fieldset-legend text-sm">{legend}</legend>
	<div class="join">
		<button
			type="button"
			class="btn join-item min-h-12 min-w-12 text-lg"
			aria-label={decreaseLabel}
			onclick={() => input.stepDown()}>−</button
		>
		<input
			bind:this={input}
			class="input join-item min-h-12 w-16 [appearance:textfield] text-center tabular-nums [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
			type="number"
			inputmode="numeric"
			{name}
			{min}
			{max}
			{value}
			aria-label={legend}
		/>
		<button
			type="button"
			class="btn join-item min-h-12 min-w-12 text-lg"
			aria-label={increaseLabel}
			onclick={() => input.stepUp()}>+</button
		>
	</div>
</fieldset>
