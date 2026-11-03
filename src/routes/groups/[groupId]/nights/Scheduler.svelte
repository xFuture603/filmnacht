<script lang="ts">
	import { Clock } from '@lucide/svelte';
	import { MediaQuery } from 'svelte/reactivity';
	import { t, type Locale } from '$lib/i18n';

	let {
		locale,
		today,
		defaults,
		locationMax,
		echo
	}: {
		locale: Locale;
		today: string;
		defaults: { day: string | null; time: string; location: string };
		locationMax: number;
		echo: { day?: string; time?: string; location?: string } | undefined;
	} = $props();

	// Laid out like a new event in Apple's Calendar: label left, value right,
	// the suggestions already filled in. On a touch screen the fields are the
	// device's own pickers (calendar sheet, time wheel), which explain
	// themselves. With a mouse the same native fields are split into small
	// segments that hide how to change them, so there the rows show outlined
	// fields, the whole Day field opens the calendar, and the time is plain
	// text that is selected on click and typed over.
	// Rendered for touch first (false on the server), then switched.
	const mouse = new MediaQuery('(pointer: fine)', false);

	const row = 'flex min-h-12 items-center gap-3 px-4 py-2 sm:px-6';
	const field = $derived([
		'min-h-11 min-w-0 flex-1 rounded-field tabular-nums',
		'placeholder:text-base-content/70 focus-visible:outline-2 focus-visible:outline-base-content',
		mouse.current
			? 'h-11 max-w-64 border border-base-content/20 bg-base-100 px-3 transition-colors hover:border-base-content/50'
			: // Borderless, like a value in a grouped list. WebKit centres the
				// date and time on their own; keep them with the other values.
				'-me-2 bg-transparent px-2 text-end [&::-webkit-date-and-time-value]:text-end'
	]);

	function openPicker(event: MouseEvent) {
		// Anywhere on the field, not only on the browser's small icon.
		try {
			(event.currentTarget as HTMLInputElement).showPicker();
		} catch {
			// Older browsers: the field still takes typing.
		}
	}
</script>

<div class="divide-y divide-base-content/10 overflow-hidden rounded-box bg-base-100">
	<label class={row}>
		<span class="shrink-0 font-bold">{t(locale, 'nights.day')}</span>
		<input
			type="date"
			name="day"
			required
			min={today}
			value={echo?.day ?? defaults.day ?? ''}
			onclick={mouse.current ? openPicker : undefined}
			class={[field, mouse.current && 'ms-auto cursor-pointer']}
		/>
	</label>
	{#if mouse.current}
		<label class={row}>
			<span class="shrink-0 font-bold">{t(locale, 'nights.time')}</span>
			<span class="relative ms-auto flex min-w-0 flex-1 max-w-64">
				<input
					name="time"
					required
					inputmode="numeric"
					autocomplete="off"
					pattern="([01]?[0-9]|2[0-3])[:.]?[0-5][0-9]"
					// The browser shows this when the pattern is not met.
					title={t(locale, 'nights.time_hint')}
					value={echo?.time ?? defaults.time}
					onfocus={(e) => e.currentTarget.select()}
					onmouseup={(e) => e.preventDefault()}
					class={[field, 'w-full pe-10']}
				/>
				<Clock
					class="pointer-events-none absolute end-3 top-1/2 size-4 -translate-y-1/2 text-base-content/70"
				/>
			</span>
		</label>
	{:else}
		<label class={row}>
			<span class="shrink-0 font-bold">{t(locale, 'nights.time')}</span>
			<input type="time" name="time" required value={echo?.time ?? defaults.time} class={field} />
		</label>
	{/if}
	<label class={row}>
		<span class="shrink-0 font-bold">{t(locale, 'nights.location')}</span>
		<input
			name="location"
			maxlength={locationMax}
			value={echo?.location ?? defaults.location}
			placeholder={t(locale, 'nights.optional')}
			class={[field, mouse.current && 'ms-auto']}
		/>
	</label>
</div>
