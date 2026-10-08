<script lang="ts">
	import { t } from '$lib/i18n';
	import ConfirmButton from '$lib/components/ConfirmButton.svelte';
	import PageHeader from '$lib/components/PageHeader.svelte';
	import {
		CalendarPlus,
		Check,
		ChevronLeft,
		CircleCheck,
		CircleQuestionMark,
		CircleX,
		Dices,
		Eye,
		Film,
		MapPin,
		RotateCcw,
		Star,
		X
	} from '@lucide/svelte';
	import NightStatus from '$lib/components/NightStatus.svelte';
	import { onMount } from 'svelte';
	import { invalidateAll } from '$app/navigation';
	import { startLiveRefresh } from '$lib/live-refresh';
	let { data, form } = $props();

	// A draw, RSVPs and ratings by others show up without a reload.
	onMount(() => startLiveRefresh(invalidateAll));

	const card = 'card mb-4 border border-base-300 bg-base-100 shadow-sm';
	const answers = ['yes', 'maybe', 'no'] as const;
	const answerIcons = { yes: Check, maybe: CircleQuestionMark, no: X };

	let score = $derived(data.ratings.mine?.score ?? 5);
	const fmt = (n: number) =>
		new Intl.NumberFormat(data.locale === 'de' ? 'de-DE' : 'en-GB', {
			minimumFractionDigits: 1,
			maximumFractionDigits: 1
		}).format(Number(n));
	const rv = $derived(data.ratings);
	const rateOpen = $derived(data.ratings.window.state === 'open');
	const signed = (n: number) => (n > 0 ? '+' : '') + fmt(n);
</script>

<a
	class="btn btn-ghost btn-sm mb-2 min-h-12 gap-1 px-2"
	href="/groups/{data.group.groupId}/nights"
	data-sveltekit-preload-data="off"
>
	<ChevronLeft class="size-4" />{t(data.locale, 'night.back')}
</a>

<PageHeader
	title={data.night.when}
	subtitle={data.night.location ?? undefined}
	subtitleIcon={MapPin}
>
	{#snippet action()}
		<NightStatus status={data.night.status} locale={data.locale} />
	{/snippet}
</PageHeader>

{#if data.night.status !== 'cancelled'}
	<a
		class="btn btn-ghost btn-sm mb-4 min-h-12 gap-1 px-2"
		href="/groups/{data.group.groupId}/nights/{data.night.id}/calendar.ics"
		download
		data-sveltekit-reload
	>
		<CalendarPlus class="size-4" />{t(data.locale, 'night.add_to_calendar')}
	</a>
{/if}

{#if form?.error}
	<div class="alert alert-error alert-soft mb-4" role="alert">{t(data.locale, form.error)}</div>
{/if}

<section class={card}>
	<div class="card-body">
		<h2 class="card-title text-lg">{t(data.locale, 'night.film')}</h2>
		{#if data.film}
			<div class="flex items-center gap-3">
				<Film class="size-8 shrink-0 text-base-content/50" strokeWidth={1.5} />
				<p class="text-lg font-bold break-words">
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
					{#if data.night.redrawUsed}
						<span class="badge align-middle badge-sm badge-neutral"
							>{t(data.locale, 'night.redrawn_badge')}</span
						>
					{/if}
				</p>
			</div>
		{:else if data.filmHidden}
			<div class="flex items-center gap-3">
				<Dices class="size-8 shrink-0 text-base-content/50" strokeWidth={1.5} />
				<p>{t(data.locale, 'night.hidden')}</p>
			</div>
		{:else}
			<p class="text-base-content/70">{t(data.locale, `nights.status.${data.night.status}`)}</p>
		{/if}
		{#if data.night.drawnAutomatically}
			<p class="text-sm text-base-content/70">{t(data.locale, 'night.drawn_auto')}</p>
		{/if}
	</div>
</section>

{#if data.ratings.window.state !== 'not_ratable'}
	<section class={card}>
		<div class="card-body">
			<!-- One state at a time: what you can do now, or what the group thought. -->
			<div class="flex items-baseline justify-between gap-2">
				<h2 class="card-title text-lg">{t(data.locale, 'ratings.title')}</h2>
				{#if rateOpen && !rv.revealed && rv.count > 0}
					<span class="text-sm text-base-content/70 tabular-nums"
						>{t(data.locale, 'ratings.progress', { count: rv.count })}</span
					>
				{/if}
			</div>

			{#snippet rateForm()}
				<form method="POST" action="?/rate" class="flex flex-col gap-3">
					<div class="flex min-h-12 items-center gap-3">
						<output for="score" class="w-[4ch] shrink-0 text-3xl font-bold tabular-nums"
							>{fmt(score)}</output
						>
						<input
							id="score"
							type="range"
							name="score"
							min="1"
							max="10"
							step="0.5"
							bind:value={score}
							aria-label={t(data.locale, 'ratings.score')}
							class="range flex-1 range-primary"
						/>
					</div>
					<details open={Boolean(rv.mine?.comment)}>
						<summary class="link min-h-12 cursor-pointer text-sm link-hover"
							>{t(data.locale, 'ratings.add_comment')}</summary
						>
						<textarea
							name="comment"
							maxlength="500"
							rows="2"
							aria-label={t(data.locale, 'ratings.comment')}
							class="textarea mt-1 w-full">{rv.mine?.comment ?? ''}</textarea
						>
					</details>
					<button class="btn min-h-12 w-full btn-primary sm:w-auto sm:self-start">
						<Star class="size-4" />{t(data.locale, 'ratings.save')}
					</button>
				</form>
			{/snippet}

			{#if rv.window.state === 'before'}
				<p class="text-base-content/70">
					{t(data.locale, 'ratings.opens', { when: data.ratingTimes.opens ?? '' })}
				</p>
			{:else}
				{#if rateOpen && rv.mine === null && !rv.revealed}
					<!-- Not rated yet. After a reveal the results lead, and this moves below them. -->
					{#if data.film}
						<p class="font-bold">{t(data.locale, 'ratings.ask', { title: data.film.title })}</p>
					{/if}
					{@render rateForm()}
				{:else if rv.mine && !rv.revealed}
					<p class="flex items-baseline gap-2">
						<span class="text-base-content/70">{t(data.locale, 'ratings.you_gave')}</span>
						<span class="text-3xl font-bold tabular-nums">{fmt(rv.mine.score)}</span>
					</p>
					<p class="text-sm text-base-content/70">{t(data.locale, 'ratings.hidden_until')}</p>
					{#if rateOpen}
						<!-- <details>: changing works without JavaScript too. The summary is
						     only the way in, so it goes once the form is open. -->
						<details class="group mt-1">
							<summary class="btn min-h-12 w-full btn-outline group-open:hidden sm:w-auto"
								>{t(data.locale, 'ratings.change')}</summary
							>
							<div class="mt-2 flex flex-col gap-2">
								{@render rateForm()}
								<form method="POST" action="?/withdrawRating">
									<button class="btn min-h-12 w-full btn-ghost sm:w-auto"
										>{t(data.locale, 'ratings.withdraw')}</button
									>
								</form>
							</div>
						</details>
					{/if}
				{/if}

				{#if rateOpen && !rv.revealed && data.isOwner && rv.count > 0}
					<form method="POST" action="?/reveal" class="mt-1 flex flex-col">
						<ConfirmButton
							armed={form?.confirm === 'reveal'}
							armedLabel={t(data.locale, 'confirm.again')}
							class="btn min-h-12 w-full btn-outline sm:w-auto sm:self-start"
						>
							<Eye class="size-4" />{t(data.locale, 'ratings.reveal')}
						</ConfirmButton>
					</form>
				{/if}

				{#if rv.results}
					{@const results = rv.results}
					<div class="flex flex-wrap items-baseline gap-x-3 gap-y-1">
						<span class="text-4xl font-bold tabular-nums">{fmt(results.average)}</span>
						<span class="text-sm text-base-content/70">
							{t(data.locale, 'ratings.average_line', {
								count: results.ratings.length
							})}{#if results.tmdb}
								· {t(data.locale, 'ratings.tmdb', {
									delta: signed(results.tmdb.delta),
									tmdb: fmt(results.tmdb.rating)
								})}{/if}
						</span>
					</div>
					<ul class="divide-y divide-base-300">
						{#each [...results.ratings].sort((a, b) => b.score - a.score) as entry, i (i)}
							<li class="flex flex-col gap-1 py-2">
								<div class="flex items-center justify-between gap-2">
									<span class="min-w-0 truncate">{entry.name}</span>
									<span class="font-bold tabular-nums">{fmt(entry.score)}</span>
								</div>
								{#if entry.comment}
									<p class="text-sm break-words text-base-content/70">{entry.comment}</p>
								{/if}
							</li>
						{/each}
					</ul>
				{/if}

				{#if rateOpen && rv.mine === null && rv.revealed}
					<!-- Revealed, but the window is still open for whoever has not rated. -->
					<details class="group">
						<summary class="btn min-h-12 w-full btn-outline group-open:hidden sm:w-auto"
							>{t(data.locale, 'ratings.rate_too')}</summary
						>
						<div class="mt-2">{@render rateForm()}</div>
					</details>
				{/if}

				{#if rv.window.state === 'closed'}
					<p class="text-sm text-base-content/70">
						{t(data.locale, 'ratings.closed', { when: data.ratingTimes.closed ?? '' })}
					</p>
				{/if}
			{/if}
		</div>
	</section>
{/if}

{#if data.night.status === 'scheduled' || data.night.status === 'drawn'}
	<section class={card}>
		<div class="card-body">
			<h2 class="card-title text-lg">{t(data.locale, 'night.responses')}</h2>
			<form method="POST" action="?/respond" class="join w-full">
				{#each answers as answer (answer)}
					{@const AnswerIcon = answerIcons[answer]}
					<button
						name="response"
						value={answer}
						aria-pressed={data.night.myResponse === answer}
						class={[
							'btn join-item min-h-12 flex-1 gap-1 px-2',
							data.night.myResponse === answer ? 'btn-primary' : 'btn-outline'
						]}
					>
						<AnswerIcon class="size-4 shrink-0" />{t(data.locale, `nights.rsvp.${answer}`)}
					</button>
				{/each}
			</form>
			{#if data.night.responses.length === 0}
				<p class="text-sm text-base-content/70">{t(data.locale, 'night.no_responses')}</p>
			{:else}
				<ul class="divide-y divide-base-300">
					{#each data.night.responses as r (r.displayName + r.response)}
						<li class="flex min-h-12 items-center justify-between gap-2 py-2">
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
				<form method="POST" action="?/draw" class="flex flex-col gap-1">
					<button class="btn btn-primary min-h-12 w-full sm:w-auto sm:self-start">
						<Dices class="size-4" />{t(data.locale, 'night.draw')}
					</button>
					{#if !data.canDraw}
						<p class="text-sm text-base-content/70">
							{t(data.locale, 'night.error.no_candidates')}
						</p>
					{/if}
				</form>
			{:else}
				<form method="POST" action="?/markWatched" class="flex flex-col gap-1">
					<ConfirmButton
						armed={form?.confirm === 'markWatched'}
						armedLabel={t(data.locale, 'confirm.again')}
						class="btn btn-outline min-h-12 w-full sm:w-auto sm:self-start"
					>
						<CircleCheck class="size-4" />{t(data.locale, 'night.mark_watched')}
					</ConfirmButton>
					<p class="text-sm text-base-content/70">{t(data.locale, 'night.mark_watched_hint')}</p>
				</form>

				{#if !data.night.redrawUsed}
					<form method="POST" action="?/redraw" class="mt-2 flex flex-col gap-1">
						<ConfirmButton
							armed={form?.confirm === 'redraw'}
							armedLabel={t(data.locale, 'confirm.again')}
							class="btn btn-outline min-h-12 w-full sm:w-auto sm:self-start"
						>
							<RotateCcw class="size-4" />{t(data.locale, 'night.redraw')}
						</ConfirmButton>
						<p class="text-sm text-base-content/70">{t(data.locale, 'night.redraw_hint')}</p>
					</form>
				{/if}
			{/if}

			<form method="POST" action="?/cancel" class="mt-2 flex flex-col gap-1">
				<ConfirmButton
					armed={form?.confirm === 'cancel'}
					armedLabel={t(data.locale, 'confirm.again')}
					destructive
					quiet
					class="btn min-h-12 self-start"
				>
					<CircleX class="size-4" />{t(data.locale, 'night.cancel')}
				</ConfirmButton>
			</form>
		</div>
	</section>
{/if}
