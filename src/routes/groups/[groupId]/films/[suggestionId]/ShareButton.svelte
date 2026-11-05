<script lang="ts">
	import { onMount } from 'svelte';
	import { Share } from '@lucide/svelte';
	import { t, type Locale } from '$lib/i18n';
	import { posterFile, shareOrCopy, shareText } from '$lib/share';
	import Toast from '$lib/components/Toast.svelte';

	let {
		locale,
		film,
		group
	}: {
		locale: Locale;
		film: { title: string; year: number | null; posterUrl: string | null };
		group: string;
	} = $props();

	// Sharing needs JavaScript, so without it there is no button that does nothing.
	let ready = $state(false);
	let poster: File | null = null;
	let copies = $state(0);

	onMount(() => {
		ready = true;
		posterFile(film.posterUrl).then((file) => (poster = file));
	});

	async function share() {
		const text = shareText(locale, film, group, location.href);
		const result = await shareOrCopy(text, poster);
		if (result === 'copied') copies += 1;
		// No share menu and no clipboard: hand over the text to copy by hand.
		if (result === 'failed') prompt(t(locale, 'film.share_manual'), text);
	}
</script>

{#if ready}
	<button
		type="button"
		class="btn btn-outline min-h-12 w-12 shrink-0 px-0"
		aria-label={t(locale, 'film.share')}
		onclick={share}
	>
		<Share class="size-5" />
	</button>
{/if}

{#key copies}
	{#if copies > 0}
		<Toast message={t(locale, 'film.share_copied')} {locale} />
	{/if}
{/key}
