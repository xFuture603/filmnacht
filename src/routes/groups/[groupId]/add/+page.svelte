<script lang="ts">
	import RequiredNote from '$lib/components/RequiredNote.svelte';
	import { t } from '$lib/i18n';
	import PageHeader from '$lib/components/PageHeader.svelte';
	import Poster from '$lib/components/Poster.svelte';
	import Field from '$lib/components/Field.svelte';
	import { liveSearch } from '$lib/live-search';
	import type { TmdbSearchResult } from '$lib/server/tmdb';
	let { data, form } = $props();

	// Typed results replace a submitted search's; null falls back to the form's
	// (the no-JavaScript path, where the Search button posts the page).
	let live = $state<TmdbSearchResult[] | null>(null);
	let liveFailed = $state(false);
	let busy = $state(false);
	const results = $derived(live ?? form?.results);
	const search = liveSearch<TmdbSearchResult>({
		url: (q) => `/groups/${data.group.groupId}/add/search?q=${encodeURIComponent(q)}`,
		onResults: (r) => ((live = r), (liveFailed = false)),
		onError: () => (liveFailed = true),
		onBusy: (b) => (busy = b)
	});
	const status = $derived(
		busy
			? t(data.locale, 'add.searching')
			: liveFailed
				? t(data.locale, 'add.search_failed')
				: !results
					? ''
					: results.length === 0
						? t(data.locale, 'add.search_none')
						: results.length === 1
							? t(data.locale, 'add.found_one')
							: t(data.locale, 'add.found', { count: results.length })
	);
</script>

<PageHeader title={t(data.locale, 'add.title', { group: data.group.name })} />

{#if form?.error}
	<div class="alert alert-error alert-soft mb-4" role="alert">{t(data.locale, form.error)}</div>
{/if}

<section class="card mb-4 border border-base-300 bg-base-100 shadow-sm">
	<div class="card-body">
		<h2 class="card-title text-lg">{t(data.locale, 'add.search_heading')}</h2>

		{#if !data.tmdbEnabled}
			<div class="alert alert-info alert-soft" role="status">
				{t(data.locale, 'add.search_disabled')}
			</div>
		{:else}
			<form
				method="POST"
				action="?/search"
				class="flex gap-2"
				onsubmit={(e) => {
					e.preventDefault();
					search.now(String(new FormData(e.currentTarget).get('query') ?? ''));
				}}
			>
				<label class="input min-h-12 w-full flex-1">
					<input
						name="query"
						type="search"
						enterkeyhint="search"
						required
						placeholder={t(data.locale, 'add.search_placeholder')}
						aria-label={t(data.locale, 'add.search_placeholder')}
						autocomplete="off"
						oninput={(e) => search.type(e.currentTarget.value)}
					/>
					{#if busy}<span class="loading loading-spinner loading-sm opacity-70"></span>{/if}
				</label>
				<button class="btn btn-primary min-h-12">{t(data.locale, 'add.search_submit')}</button>
			</form>

			<!-- Results change as you type; this says so to a screen reader. -->
			<p class="sr-only" role="status" aria-live="polite">{status}</p>
			{#if liveFailed}
				<p class="text-base-content/70">{t(data.locale, 'add.search_failed')}</p>
			{:else if results}
				{#if results.length === 0}
					<p class="text-base-content/70">{t(data.locale, 'add.search_none')}</p>
				{:else}
					<form method="POST" action="?/adopt" class="mt-2" aria-busy={busy}>
						<ul class="mb-4 grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4">
							{#each results as result (result.tmdbId)}
								<li class="flex min-w-0 flex-col gap-2">
									<Poster src={result.posterUrl} />
									<!-- flex-1 + mt-auto: a two-line title or a missing year must not
									     shift this card's button out of line with its neighbours. -->
									<div class="flex min-w-0 flex-1 flex-col">
										<p class="line-clamp-2 font-bold break-words">{result.title}</p>
										<p class="mb-1 text-sm text-base-content/70">{result.year ?? ''}</p>
										<button
											name="tmdbId"
											value={result.tmdbId}
											class="btn btn-outline btn-sm mt-auto min-h-12 w-full"
											aria-label={t(data.locale, 'add.adopt_named', { title: result.title })}
										>
											{t(data.locale, 'add.adopt')}
										</button>
									</div>
								</li>
							{/each}
						</ul>
						<Field label={t(data.locale, 'add.note')} hint={t(data.locale, 'add.note_hint')}>
							<textarea name="note" maxlength={data.noteMax} rows="2" class="textarea w-full"
							></textarea>
						</Field>
					</form>
				{/if}
			{/if}
		{/if}
	</div>
</section>

<section class="card mb-6 border border-base-300 bg-base-100 shadow-sm">
	<div class="card-body">
		<h2 class="card-title text-lg">{t(data.locale, 'add.manual_heading')}</h2>
		<form method="POST" action="?/manual" class="flex flex-col gap-2">
			<RequiredNote locale={data.locale} />
			<Field label={t(data.locale, 'add.film_title')}>
				<input name="title" required maxlength="200" class="input min-h-12 w-full" />
			</Field>
			<Field label={t(data.locale, 'add.note')} hint={t(data.locale, 'add.note_hint')}>
				<textarea name="note" maxlength={data.noteMax} rows="2" class="textarea w-full"></textarea>
			</Field>
			<!-- The fallback: primary only when search is not available. -->
			<button
				class={[
					'btn mt-2 min-h-12 w-full sm:w-auto sm:self-start',
					data.tmdbEnabled ? 'btn-outline' : 'btn-primary'
				]}>{t(data.locale, 'add.submit')}</button
			>
		</form>
	</div>
</section>

<a
	class="btn btn-outline min-h-12"
	href="/groups/{data.group.groupId}"
	data-sveltekit-preload-data="off"
>
	{t(data.locale, 'add.back')}
</a>
