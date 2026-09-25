<script lang="ts">
	import { t } from '$lib/i18n';
	import PageHeader from '$lib/components/PageHeader.svelte';
	import Field from '$lib/components/Field.svelte';
	import Icon from '$lib/components/Icon.svelte';
	import NightStatus from '$lib/components/NightStatus.svelte';
	let { data, form } = $props();

	const card = 'card mb-4 border border-base-300 bg-base-100 shadow-sm';
	const answers = ['yes', 'maybe', 'no'] as const;
</script>

<a class="btn btn-ghost btn-sm mb-2 min-h-11 px-2" href="/groups/{data.group.groupId}/nights">
	← {t(data.locale, 'night.back')}
</a>

<PageHeader
	title={data.night.when}
	subtitle={data.night.location ? `📍 ${data.night.location}` : undefined}
>
	{#snippet action()}
		<NightStatus status={data.night.status} locale={data.locale} />
	{/snippet}
</PageHeader>

{#if form?.error}
	<div class="alert alert-error alert-soft mb-4" role="alert">{t(data.locale, form.error)}</div>
{/if}

<section class={card}>
	<div class="card-body">
		<h2 class="card-title text-lg">{t(data.locale, 'night.film')}</h2>
		{#if data.film}
			<div class="flex items-center gap-3">
				<Icon name="film" class="size-8 shrink-0 text-base-content/50" />
				<p class="text-lg font-semibold break-words">
					{#if data.film.onlyCandidate}
						{t(data.locale, 'night.drawn_one', { title: data.film.title })}
					{:else if data.film.byFormer}
						{t(data.locale, 'night.drawn_former', { title: data.film.title })}
					{:else}
						{t(data.locale, 'night.drawn', {
							title: data.film.title,
							name: data.film.by ?? ''
						})}
					{/if}
				</p>
			</div>
		{:else if data.filmHidden}
			<div class="flex items-center gap-3">
				<Icon name="dice" class="size-8 shrink-0 text-base-content/50" />
				<p>{t(data.locale, 'night.hidden')}</p>
			</div>
		{:else}
			<p class="text-base-content/70">{t(data.locale, `nights.status.${data.night.status}`)}</p>
		{/if}
	</div>
</section>

{#if data.night.status === 'scheduled' || data.night.status === 'drawn'}
	<section class={card}>
		<div class="card-body">
			<h2 class="card-title text-lg">{t(data.locale, 'night.responses')}</h2>
			<form method="POST" action="?/respond" class="join w-full">
				{#each answers as answer (answer)}
					<button
						name="response"
						value={answer}
						aria-pressed={data.night.myResponse === answer}
						class={[
							'btn join-item min-h-11 flex-1',
							data.night.myResponse === answer ? 'btn-primary' : 'btn-outline'
						]}>{t(data.locale, `nights.rsvp.${answer}`)}</button
					>
				{/each}
			</form>
			{#if data.night.responses.length === 0}
				<p class="text-sm text-base-content/70">{t(data.locale, 'night.no_responses')}</p>
			{:else}
				<ul class="divide-y divide-base-300">
					{#each data.night.responses as r (r.displayName + r.response)}
						<li class="flex min-h-11 items-center justify-between gap-2 py-2">
							<span class="min-w-0 truncate">{r.displayName}</span>
							<span class="text-sm text-base-content/70"
								>{t(data.locale, `nights.rsvp.${r.response}`)}</span
							>
						</li>
					{/each}
				</ul>
			{/if}
		</div>
	</section>
{/if}

{#if data.isOwner && (data.night.status === 'scheduled' || data.night.status === 'drawn')}
	<section class={card}>
		<div class="card-body">
			<h2 class="card-title text-lg">{t(data.locale, 'night.owner')}</h2>

			{#if data.night.status === 'scheduled'}
				<form method="POST" action="?/draw">
					<button class="btn btn-primary min-h-11 w-full sm:w-auto">
						<Icon name="dice" class="size-5" />{t(data.locale, 'night.draw')}
					</button>
				</form>
			{:else}
				<form method="POST" action="?/markWatched" class="flex flex-col gap-1">
					<button class="btn btn-primary min-h-11 w-full sm:w-auto sm:self-start"
						>{t(data.locale, 'night.mark_watched')}</button
					>
					<p class="text-sm text-base-content/70">{t(data.locale, 'night.mark_watched_hint')}</p>
				</form>

				{#if !data.night.redrawUsed}
					<form method="POST" action="?/redraw" class="mt-2 flex flex-col gap-2">
						<Field
							label={t(data.locale, 'night.redraw_reason')}
							hint={t(data.locale, 'night.redraw_hint')}
						>
							<input
								name="reason"
								required
								maxlength={data.reasonMax}
								class="input min-h-11 w-full"
							/>
						</Field>
						<button class="btn btn-outline min-h-11 w-full sm:w-auto sm:self-start"
							>{t(data.locale, 'night.redraw')}</button
						>
					</form>
				{/if}
			{/if}

			<form method="POST" action="?/cancel" class="mt-2">
				<button class="btn btn-ghost min-h-11 w-full text-error sm:w-auto"
					>{t(data.locale, 'night.cancel')}</button
				>
			</form>
		</div>
	</section>
{/if}
