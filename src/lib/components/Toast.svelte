<script lang="ts">
	import { CircleCheck, X } from '@lucide/svelte';
	import { fly } from 'svelte/transition';
	import { t, type Locale } from '$lib/i18n';

	/**
	 * A success notification that floats instead of pushing the page around:
	 * bottom-centre above the tab bar on phones, top-right on desktop. Errors do
	 * not use this: they stay inline, next to what needs fixing.
	 *
	 * Re-create it per submission ({#key form}) so the same message shows again.
	 * Without JavaScript it simply stays put; with it, it leaves after a few
	 * seconds, unless the pointer or focus is on it.
	 */
	let { message, locale }: { message: string; locale: Locale } = $props();

	let open = $state(true);
	let held = $state(false);
	let hydrated = $state(false);

	$effect(() => {
		hydrated = true;
		if (held) return;
		const id = setTimeout(() => (open = false), 6000);
		return () => clearTimeout(id);
	});

	const reduced =
		typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
</script>

{#if open}
	<div
		class="fixed inset-x-4 bottom-[calc(5rem+env(safe-area-inset-bottom))] z-50 flex justify-center md:inset-x-auto md:top-18 md:right-4 md:bottom-auto"
		transition:fly={{ y: reduced ? 0 : 12, duration: reduced ? 0 : 180 }}
	>
		<div
			role="status"
			class="alert alert-success w-full max-w-sm items-start shadow-lg"
			onpointerenter={() => (held = true)}
			onpointerleave={() => (held = false)}
			onfocusin={() => (held = true)}
			onfocusout={() => (held = false)}
		>
			<CircleCheck class="mt-0.5 size-5 shrink-0" />
			<span class="min-w-0 flex-1 break-words">{message}</span>
			{#if hydrated}
				<button
					type="button"
					class="btn btn-ghost btn-sm btn-square -my-1 -mr-2 size-9 min-h-9"
					aria-label={t(locale, 'common.close')}
					onclick={() => (open = false)}><X class="size-4" /></button
				>
			{/if}
		</div>
	</div>
{/if}
