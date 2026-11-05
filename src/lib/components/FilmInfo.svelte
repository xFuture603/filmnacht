<script lang="ts">
	import type { Snippet } from 'svelte';
	import { Star } from '@lucide/svelte';
	import { t, type Locale } from '$lib/i18n';
	import PageHeader from '$lib/components/PageHeader.svelte';
	import Poster from '$lib/components/Poster.svelte';
	import type { TmdbCredits } from '$lib/server/tmdb';

	let {
		locale,
		film,
		details,
		tmdbUrl,
		children
	}: {
		locale: Locale;
		film: {
			tmdbId: number | null;
			title: string;
			year: number | null;
			posterUrl: string | null;
			runtime: number | null;
			genres: string[];
			tmdbRating: number | null;
		};
		details: TmdbCredits | null;
		tmdbUrl: string | null;
		/** Whatever can be done with the film, between its title and its details. */
		children?: Snippet;
	} = $props();

	const facts = $derived(
		[
			film.year,
			film.runtime ? t(locale, 'film.minutes', { n: film.runtime }) : null,
			film.genres.join(', ') || null
		]
			.filter(Boolean)
			.join(' · ')
	);
	const rating = $derived(
		film.tmdbRating === null
			? null
			: new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(film.tmdbRating)
	);
	// Nothing worth a section: say so once instead of showing empty headings.
	const empty = $derived(
		!details || (!details.overview && details.directors.length === 0 && details.cast.length === 0)
	);
</script>

<PageHeader title={film.title} subtitle={facts || undefined} />

{@render children?.()}

<section class="card bg-base-100">
	<div class="card-body flex-col gap-6 text-base sm:flex-row sm:items-start">
		<div class="w-full max-w-50 shrink-0 sm:w-48">
			<Poster src={film.posterUrl} />
		</div>

		<div class="flex min-w-0 flex-col gap-4">
			{#if rating}
				<p class="flex items-center gap-1" aria-label={t(locale, 'film.rating', { rating })}>
					<Star class="size-4" aria-hidden="true" />
					<span
						><span class="font-bold">{rating}</span><span class="text-base-content/70">/10</span
						></span
					>
				</p>
			{/if}

			{#if empty}
				<!-- A TMDB film whose details failed to load will have them later; a
			     hand-entered one never will. -->
				<p class="text-base-content/70">
					{t(locale, film.tmdbId && !details ? 'film.unavailable' : 'film.no_details')}
				</p>
			{:else if details}
				{#if details.overview}
					<p class="leading-relaxed">{details.overview}</p>
				{/if}
				{#if details.directors.length > 0}
					<div>
						<h2 class="text-sm font-bold">{t(locale, 'film.director')}</h2>
						<p>{details.directors.join(', ')}</p>
					</div>
				{/if}
				{#if details.cast.length > 0}
					<div>
						<h2 class="text-sm font-bold">{t(locale, 'film.cast')}</h2>
						<ul>
							{#each details.cast as person, i (i)}
								<li>
									{person.character
										? t(locale, 'film.as', {
												name: person.name,
												character: person.character
											})
										: person.name}
								</li>
							{/each}
						</ul>
					</div>
				{/if}
			{/if}

			{#if tmdbUrl}
				<!-- TMDB's terms ask for this credit. -->
				<p class="text-sm text-base-content/70">
					<a class="link" href={tmdbUrl} rel="noreferrer">{t(locale, 'film.source')}</a>
				</p>
			{/if}
		</div>
	</div>
</section>
