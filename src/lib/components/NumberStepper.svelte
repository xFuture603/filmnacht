<script lang="ts">
	/**
	 * A whole number with − and +, typed or stepped, with its unit beside it.
	 * One outlined box like the schedule page's fields, the buttons drawn
	 * inside it, so it reads as one control and not three black boxes.
	 * The field stays a plain number input, so typing works without JavaScript
	 * and the server keeps checking the range. Every stepper is the same
	 * width, so a page of them lines up whatever the number and its unit.
	 */
	import { Minus, Plus } from '@lucide/svelte';

	let {
		legend,
		name,
		value,
		min,
		max,
		unit,
		decreaseLabel,
		increaseLabel
	}: {
		legend: string;
		name: string;
		value: number;
		min: number;
		max: number;
		/** The unit for a count, so "1 hour" and "2 hours" both read right. */
		unit?: (n: number) => string;
		decreaseLabel: string;
		increaseLabel: string;
	} = $props();

	// svelte-ignore state_referenced_locally
	let n = $state<number | null>(value);
	const step = (by: number) => (n = Math.min(max, Math.max(min, (n ?? value) + by)));

	const button = [
		'grid w-12 shrink-0 cursor-pointer place-items-center text-base-content/70 transition-colors',
		'hover:bg-base-content/5 hover:text-base-content disabled:pointer-events-none disabled:opacity-40',
		'focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-base-content'
	];
</script>

<fieldset class="fieldset">
	<legend class="fieldset-legend text-sm">{legend}</legend>
	<div
		class="flex h-12 w-fit overflow-hidden rounded-field border border-base-content/20 bg-base-100 transition-colors hover:border-base-content/50"
	>
		<button
			type="button"
			class={button}
			aria-label={decreaseLabel}
			disabled={n !== null && n <= min}
			onclick={() => step(-1)}><Minus class="size-4" /></button
		>
		<label
			class="flex w-28 items-center justify-center gap-1.5 border-x border-base-content/10 has-focus-visible:outline-2 has-focus-visible:-outline-offset-2 has-focus-visible:outline-base-content"
		>
			<input
				class="w-[2ch] [appearance:textfield] bg-transparent text-end tabular-nums outline-none [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
				type="number"
				inputmode="numeric"
				{name}
				{min}
				{max}
				bind:value={n}
				onfocus={(e) => e.currentTarget.select()}
				aria-label={legend}
			/>
			{#if unit}<span class="text-base-content/70">{unit(n ?? value)}</span>{/if}
		</label>
		<button
			type="button"
			class={button}
			aria-label={increaseLabel}
			disabled={n !== null && n >= max}
			onclick={() => step(1)}><Plus class="size-4" /></button
		>
	</div>
</fieldset>
