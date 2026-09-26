<script lang="ts">
	import { t } from '$lib/i18n';
	import PageHeader from '$lib/components/PageHeader.svelte';
	import Poster from '$lib/components/Poster.svelte';
	import Field from '$lib/components/Field.svelte';
	let { data, form } = $props();
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
			<form method="POST" action="?/search" class="flex gap-2">
				<input
					name="query"
					required
					placeholder={t(data.locale, 'add.search_placeholder')}
					aria-label={t(data.locale, 'add.search_placeholder')}
					class="input min-h-11 w-full flex-1"
				/>
				<button class="btn btn-primary min-h-11">{t(data.locale, 'add.search_submit')}</button>
			</form>

			{#if form?.results}
				{#if form.results.length === 0}
					<p class="text-base-content/70">{t(data.locale, 'add.search_none')}</p>
				{:else}
					<form method="POST" action="?/adopt" class="mt-2">
						<ul class="mb-4 grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4">
							{#each form.results as result (result.tmdbId)}
								<li class="flex min-w-0 flex-col gap-2">
									<Poster src={result.posterUrl} />
									<div class="min-w-0">
										<p class="line-clamp-2 font-medium break-words">{result.title}</p>
										<p class="text-sm text-base-content/70">{result.year ?? ''}</p>
										<button
											name="tmdbId"
											value={result.tmdbId}
											class="btn btn-primary btn-sm mt-1 min-h-11 w-full"
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
			<Field label={t(data.locale, 'add.film_title')}>
				<input name="title" required maxlength="200" class="input min-h-11 w-full" />
			</Field>
			<Field label={t(data.locale, 'add.note')} hint={t(data.locale, 'add.note_hint')}>
				<textarea name="note" maxlength={data.noteMax} rows="2" class="textarea w-full"></textarea>
			</Field>
			<button class="btn btn-primary mt-2 min-h-11 w-full sm:w-auto sm:self-start"
				>{t(data.locale, 'add.submit')}</button
			>
		</form>
	</div>
</section>

<a class="btn btn-ghost min-h-11" href="/groups/{data.group.groupId}">
	{t(data.locale, 'add.back')}
</a>
