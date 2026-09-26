<script lang="ts">
	import { ChevronLeft, ChevronRight, Clock } from '@lucide/svelte';
	import Field from '$lib/components/Field.svelte';
	import { t, type Locale } from '$lib/i18n';
	import {
		dayLabel,
		monthGrid,
		monthTitle,
		shiftMonth,
		timeSlots,
		weekdayNames
	} from '$lib/schedule';

	let {
		locale,
		timezone,
		today,
		initialMonth,
		defaults,
		usualTime,
		locationMax,
		echo
	}: {
		locale: Locale;
		timezone: string;
		today: string;
		initialMonth: string;
		defaults: { day: string | null; time: string; location: string };
		usualTime: string | null;
		locationMax: number;
		echo: { day?: string; time?: string; otherTime?: string; location?: string } | undefined;
	} = $props();

	// Overridable deriveds: they follow the server's data (a failed submit
	// echoes the owner's choice back) and the owner's taps overwrite them.
	let month = $derived(initialMonth);
	let day = $derived(echo?.day ?? defaults.day ?? '');
	let time = $derived(echo?.time ?? defaults.time);

	// The slot list drops times as they pass, so the clock has to tick.
	let now = $state(new Date());
	$effect(() => {
		const id = setInterval(() => (now = new Date()), 60_000);
		return () => clearInterval(id);
	});

	const weeks = $derived(monthGrid(month, today));
	const slots = $derived(day ? timeSlots(day, now, timezone, usualTime) : []);
	// Keep the chosen time when it is still offered, else the next later one.
	const chosen = $derived(
		slots.includes(time) ? time : (slots.find((s) => s > time) ?? slots[0] ?? '')
	);
	const canGoBack = $derived(month > today.slice(0, 7));

	function go(event: MouseEvent, delta: number) {
		// Without JavaScript the links reload the page on ?month=; with it, the
		// calendar just turns.
		event.preventDefault();
		month = shiftMonth(month, delta);
	}
</script>

<fieldset class="flex flex-col gap-2">
	<legend class="mb-2 text-sm font-semibold">{t(locale, 'nights.day')}</legend>

	<div class="flex items-center justify-between sm:max-w-md">
		{#if canGoBack}
			<a
				href="?month={shiftMonth(month, -1)}"
				class="btn btn-ghost btn-square min-h-11"
				aria-label={t(locale, 'nights.prev_month')}
				onclick={(e) => go(e, -1)}><ChevronLeft class="size-5" /></a
			>
		{:else}
			<span class="size-11" aria-hidden="true"></span>
		{/if}
		<p class="font-semibold" aria-live="polite">{monthTitle(month, locale)}</p>
		<a
			href="?month={shiftMonth(month, 1)}"
			class="btn btn-ghost btn-square min-h-11"
			aria-label={t(locale, 'nights.next_month')}
			onclick={(e) => go(e, 1)}><ChevronRight class="size-5" /></a
		>
	</div>

	<div class="grid grid-cols-7 gap-1 text-center sm:max-w-md">
		{#each weekdayNames(locale) as name (name)}
			<span class="pb-1 text-xs font-medium text-base-content/60" aria-hidden="true">{name}</span>
		{/each}
		{#each weeks.flat() as cell, i (cell?.date ?? `blank-${i}`)}
			{#if cell}
				<label class="relative">
					<input
						type="radio"
						name="day"
						value={cell.date}
						aria-label={dayLabel(cell.date, locale)}
						checked={cell.date === day}
						disabled={cell.past}
						onchange={() => (day = cell.date)}
						class="peer sr-only"
					/>
					<span
						class={[
							'btn btn-ghost min-h-11 w-full px-0 tabular-nums',
							// A fill with dark ink, never amber text: btn-ghost would override
							// btn-primary's background and leave amber text on white.
							'peer-checked:bg-primary peer-checked:text-primary-content peer-checked:hover:bg-primary',
							'peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2',
							'peer-disabled:pointer-events-none peer-disabled:text-base-content/25',
							cell.today && 'ring-1 ring-base-content/30'
						]}>{cell.day}</span
					>
				</label>
			{:else}
				<span aria-hidden="true"></span>
			{/if}
		{/each}
	</div>
	<!-- A day chosen in another month is not in this grid, so it rides along. -->
	{#if day && !day.startsWith(month)}
		<input type="hidden" name="day" value={day} />
	{/if}
</fieldset>

<fieldset class="flex flex-col gap-2">
	<legend class="mb-2 text-sm font-semibold">{t(locale, 'nights.time')}</legend>
	{#if day && slots.length === 0}
		<p class="text-sm text-base-content/70">{t(locale, 'nights.no_times')}</p>
	{:else}
		<div class="grid grid-cols-4 gap-2 sm:grid-cols-7">
			{#each slots as slot (slot)}
				<input
					type="radio"
					name="time"
					value={slot}
					aria-label={slot}
					checked={slot === chosen}
					onchange={() => (time = slot)}
					class="btn min-h-11 px-2 tabular-nums"
				/>
			{/each}
		</div>
	{/if}
	<p class="flex items-center gap-1 text-xs text-base-content/70">
		<Clock class="size-3.5 shrink-0" />
		{t(locale, 'nights.when_hint', { zone: timezone })}
	</p>
	<Field label={t(locale, 'nights.other_time')}>
		<input
			type="time"
			name="other_time"
			value={echo?.otherTime ?? ''}
			class="input min-h-11 w-full sm:w-40"
		/>
	</Field>
</fieldset>

<Field label={t(locale, 'nights.where')}>
	<input
		name="location"
		maxlength={locationMax}
		value={echo?.location ?? defaults.location}
		class="input min-h-11 w-full"
	/>
</Field>
