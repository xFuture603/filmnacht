<script lang="ts">
	import { t } from '$lib/i18n';
	let { data, form } = $props();
</script>

<h1 class="mb-4 text-2xl font-bold">
	{t(data.locale, 'add.title', { group: data.group.name })}
</h1>

{#if form?.error}
	<div class="alert alert-error mb-4" role="alert">{t(data.locale, form.error)}</div>
{/if}

<h2 class="mb-2 text-lg font-semibold">{t(data.locale, 'add.search_heading')}</h2>

{#if !data.tmdbEnabled}
	<div class="alert mb-4" role="status">{t(data.locale, 'add.search_disabled')}</div>
{:else}
	<form method="POST" action="?/search" class="mb-4 flex max-w-md gap-2">
		<input
			name="query"
			required
			placeholder={t(data.locale, 'add.search_placeholder')}
			aria-label={t(data.locale, 'add.search_placeholder')}
			class="input input-bordered min-h-11 flex-1"
		/>
		<button class="btn btn-primary min-h-11">{t(data.locale, 'add.search_submit')}</button>
	</form>

	{#if form?.results}
		{#if form.results.length === 0}
			<p class="mb-4">{t(data.locale, 'add.search_none')}</p>
		{:else}
			<form method="POST" action="?/adopt">
				<ul class="mb-4 grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4">
					{#each form.results as result (result.tmdbId)}
						<li class="card bg-base-100 shadow-sm">
							{#if result.posterUrl}
								<img
									class="aspect-[2/3] w-full rounded-t-box object-cover"
									src={result.posterUrl}
									alt={result.title}
									loading="lazy"
									referrerpolicy="no-referrer"
								/>
							{:else}
								<div
									class="bg-base-300 flex aspect-[2/3] w-full items-center justify-center rounded-t-box p-2 text-center text-sm"
								>
									{t(data.locale, 'pool.no_poster')}
								</div>
							{/if}
							<div class="card-body gap-1 p-3">
								<p class="font-medium">{result.title}</p>
								<p class="text-sm opacity-70">{result.year ?? ''}</p>
								<button
									name="tmdbId"
									value={result.tmdbId}
									class="btn btn-secondary btn-sm mt-1 min-h-11 w-full"
									aria-label={t(data.locale, 'add.adopt_named', { title: result.title })}
								>
									{t(data.locale, 'add.adopt')}
								</button>
							</div>
						</li>
					{/each}
				</ul>
				<label class="form-control mb-6 max-w-md">
					<span class="label-text">{t(data.locale, 'add.note')}</span>
					<textarea name="note" maxlength={data.noteMax} rows="2" class="textarea textarea-bordered"
					></textarea>
					<span class="label-text-alt">{t(data.locale, 'add.note_hint')}</span>
				</label>
			</form>
		{/if}
	{/if}
{/if}

<h2 class="mb-2 text-lg font-semibold">{t(data.locale, 'add.manual_heading')}</h2>
<form method="POST" action="?/manual" class="mb-6 flex max-w-md flex-col gap-3">
	<label class="form-control">
		<span class="label-text">{t(data.locale, 'add.film_title')}</span>
		<input name="title" required maxlength="200" class="input input-bordered min-h-11" />
	</label>
	<label class="form-control">
		<span class="label-text">{t(data.locale, 'add.year')}</span>
		<input name="year" inputmode="numeric" maxlength="4" class="input input-bordered min-h-11" />
	</label>
	<label class="form-control">
		<span class="label-text">{t(data.locale, 'add.note')}</span>
		<textarea name="note" maxlength={data.noteMax} rows="2" class="textarea textarea-bordered"
		></textarea>
		<span class="label-text-alt">{t(data.locale, 'add.note_hint')}</span>
	</label>
	<button class="btn btn-primary min-h-11">{t(data.locale, 'add.submit')}</button>
</form>

<a class="btn btn-ghost min-h-11" href="/groups/{data.group.groupId}">
	{t(data.locale, 'add.back')}
</a>
