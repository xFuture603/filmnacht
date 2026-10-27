<script lang="ts">
	import { t } from '$lib/i18n';
	import PageHeader from '$lib/components/PageHeader.svelte';
	import Poster from '$lib/components/Poster.svelte';
	import { ChevronLeft, Star } from '@lucide/svelte';
	let { data } = $props();

	const film = $derived(data.film);
	const details = $derived(data.details);
	const facts = $derived(
		[
			film.year,
			film.runtime ? t(data.locale, 'film.minutes', { n: film.runtime }) : null,
			film.genres.join(', ') || null
		]
			.filter(Boolean)
			.join(' · ')
	);
	const rating = $derived(
		film.tmdbRating === null
			? null
			: new Intl.NumberFormat(data.locale, { maximumFractionDigits: 1 }).format(film.tmdbRating)
	);
	// Nothing worth a section: say so once instead of showing empty headings.
	const empty = $derived(
		!details || (!details.overview && details.directors.length === 0 && details.cast.length === 0)
	);
</script>

<a
	class="btn btn-outline mb-2 min-h-12 gap-1"
	href="/groups/{data.group.groupId}"
	data-sveltekit-preload-data="off"
>
	<ChevronLeft class="size-4" />{t(data.locale, 'film.back')}
</a>

<PageHeader title={film.title} subtitle={facts || undefined} />

<div class="flex flex-col gap-6 sm:flex-row sm:items-start">
	<div class="w-full max-w-50 shrink-0 sm:w-48">
		<Poster src={film.posterUrl} />
	</div>

	<div class="flex min-w-0 flex-col gap-4">
		{#if rating}
			<p class="flex items-center gap-1" aria-label={t(data.locale, 'film.rating', { rating })}>
				<Star class="size-4" aria-hidden="true" />
				<span class="font-bold">{rating}</span><span class="text-base-content/70">/10</span>
			</p>
		{/if}

		{#if empty}
			<p class="text-base-content/70">{t(data.locale, 'film.no_details')}</p>
		{:else if details}
			{#if details.overview}
				<p class="leading-relaxed">{details.overview}</p>
			{/if}
			{#if details.directors.length > 0}
				<div>
					<h2 class="text-sm font-bold">{t(data.locale, 'film.director')}</h2>
					<p>{details.directors.join(', ')}</p>
				</div>
			{/if}
			{#if details.cast.length > 0}
				<div>
					<h2 class="text-sm font-bold">{t(data.locale, 'film.cast')}</h2>
					<ul>
						{#each details.cast as person, i (i)}
							<li>
								{person.character
									? t(data.locale, 'film.as', { name: person.name, character: person.character })
									: person.name}
							</li>
						{/each}
					</ul>
				</div>
			{/if}
		{/if}

		{#if data.tmdbUrl}
			<!-- TMDB's terms ask for this credit. -->
			<p class="text-sm text-base-content/70">
				<a class="link" href={data.tmdbUrl} rel="noreferrer">{t(data.locale, 'film.source')}</a>
			</p>
		{/if}
	</div>
</div>
