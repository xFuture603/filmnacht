<script lang="ts">
	import { t } from '$lib/i18n';
	import PageHeader from '$lib/components/PageHeader.svelte';
	import Field from '$lib/components/Field.svelte';
	import {
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
	const signed = (n: number) => (n > 0 ? '+' : '') + fmt(n);
</script>

<a
	class="btn btn-ghost btn-sm mb-2 min-h-11 gap-1 px-2"
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

{#if form?.error}
	<div class="alert alert-error alert-soft mb-4" role="alert">{t(data.locale, form.error)}</div>
{/if}

<section class={card}>
	<div class="card-body">
		<h2 class="card-title text-lg">{t(data.locale, 'night.film')}</h2>
		{#if data.film}
			<div class="flex items-center gap-3">
				<Film class="size-8 shrink-0 text-base-content/50" strokeWidth={1.5} />
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
			<h2 class="card-title text-lg">{t(data.locale, 'ratings.title')}</h2>

			{#if data.ratings.window.state === 'before'}
				<p class="text-base-content/70">
					{t(data.locale, 'ratings.opens', { when: data.ratingTimes.opens ?? '' })}
				</p>
			{:else}
				{#if data.ratings.window.state === 'open' && (!data.ratings.revealed || data.ratings.mine === null)}
					<form method="POST" action="?/rate" class="flex flex-col gap-2">
						<Field label={t(data.locale, 'ratings.score')}>
							<output for="score" class="text-4xl font-bold tabular-nums">{fmt(score)}</output>
							<div class="flex min-h-11 items-center">
								<input
									id="score"
									type="range"
									name="score"
									min="1"
									max="10"
									step="0.5"
									bind:value={score}
									aria-label={t(data.locale, 'ratings.score')}
									class="range range-primary w-full"
								/>
							</div>
							<div class="flex justify-between text-xs text-base-content/70" aria-hidden="true">
								<span>1</span><span>5</span><span>10</span>
							</div>
						</Field>
						<Field label={t(data.locale, 'ratings.comment')}>
							<textarea name="comment" maxlength="500" rows="2" class="textarea w-full"
								>{data.ratings.mine?.comment ?? ''}</textarea
							>
						</Field>
						<button class="btn btn-primary mt-2 min-h-11 w-full sm:w-auto sm:self-start">
							<Star class="size-4" />{t(data.locale, 'ratings.save')}
						</button>
					</form>

					{#if data.ratings.mine && !data.ratings.revealed}
						<form method="POST" action="?/withdrawRating" class="flex flex-col">
							<button class="btn btn-ghost min-h-11 w-full sm:w-auto sm:self-start"
								>{t(data.locale, 'ratings.withdraw')}</button
							>
						</form>
					{/if}
				{:else if data.ratings.revealed && data.ratings.mine}
					<p class="text-sm text-base-content/70">{t(data.locale, 'ratings.your_score')}</p>
					<p class="text-4xl font-bold tabular-nums">{fmt(data.ratings.mine.score)}</p>
					<p class="text-base-content/70">{t(data.locale, 'ratings.locked')}</p>
				{/if}

				{#if !data.ratings.revealed && data.ratings.window.state === 'open'}
					{#if data.ratings.count === 0}
						<p class="text-sm text-base-content/70">{t(data.locale, 'ratings.none_yet')}</p>
					{:else}
						<p class="text-sm text-base-content/70">
							{t(data.locale, 'ratings.count', {
								count: data.ratings.count,
								names: data.ratings.rated.join(', ')
							})}
						</p>
					{/if}
					{#if data.ratings.waitingFor.length > 0}
						<p class="text-sm text-base-content/70">
							{t(data.locale, 'ratings.waiting', { names: data.ratings.waitingFor.join(', ') })}
						</p>
					{/if}

					{#if data.isOwner && data.ratings.count > 0}
						<form method="POST" action="?/reveal" class="mt-2 flex flex-col gap-1">
							<label class="flex min-h-11 cursor-pointer items-center gap-3">
								<input type="checkbox" name="confirm" required class="checkbox" />
								<span>{t(data.locale, 'ratings.confirm_reveal')}</span>
							</label>
							<button class="btn btn-outline min-h-11 w-full sm:w-auto sm:self-start">
								<Eye class="size-4" />{t(data.locale, 'ratings.reveal')}
							</button>
						</form>
					{/if}
				{/if}

				{#if data.ratings.results}
					{@const results = data.ratings.results}
					<div class="mt-2">
						<p class="text-sm text-base-content/70">{t(data.locale, 'ratings.average')}</p>
						<p class="text-4xl font-bold tabular-nums">{fmt(results.average)}</p>
					</div>
					<div class="grid grid-cols-2 gap-4">
						<div>
							<p class="text-sm text-base-content/70">{t(data.locale, 'ratings.lowest')}</p>
							<p class="tabular-nums">
								{fmt(results.lowest.score)} · {results.lowest.names.join(', ')}
							</p>
						</div>
						<div>
							<p class="text-sm text-base-content/70">{t(data.locale, 'ratings.highest')}</p>
							<p class="tabular-nums">
								{fmt(results.highest.score)} · {results.highest.names.join(', ')}
							</p>
						</div>
					</div>
					{#if results.tmdb}
						<p class="text-sm text-base-content/70">
							{t(data.locale, 'ratings.tmdb', {
								delta: signed(results.tmdb.delta),
								tmdb: fmt(results.tmdb.rating)
							})}
						</p>
					{/if}
					<ul class="divide-y divide-base-300">
						{#each results.ratings as r, i (i)}
							<li class="flex flex-col gap-1 py-2">
								<div class="flex items-center justify-between gap-2">
									<span class="min-w-0 truncate">{r.name}</span>
									<span class="tabular-nums">{fmt(r.score)}</span>
								</div>
								{#if r.comment}
									<p class="text-sm break-words text-base-content/70">{r.comment}</p>
								{/if}
							</li>
						{/each}
					</ul>
				{/if}

				{#if data.ratings.window.state === 'closed'}
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
							'btn join-item min-h-11 flex-1 gap-1 px-2',
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
				<form method="POST" action="?/draw" class="flex flex-col gap-1">
					<button
						class="btn btn-primary min-h-11 w-full sm:w-auto sm:self-start"
						disabled={!data.canDraw}
					>
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
					<label class="flex min-h-11 cursor-pointer items-center gap-3">
						<input type="checkbox" name="confirm" required class="checkbox" />
						<span>{t(data.locale, 'night.confirm_watched')}</span>
					</label>
					<button class="btn btn-primary min-h-11 w-full sm:w-auto sm:self-start">
						<CircleCheck class="size-4" />{t(data.locale, 'night.mark_watched')}
					</button>
					<p class="text-sm text-base-content/70">{t(data.locale, 'night.mark_watched_hint')}</p>
				</form>

				{#if !data.night.redrawUsed}
					<form method="POST" action="?/redraw" class="mt-2 flex flex-col gap-1">
						<label class="flex min-h-11 cursor-pointer items-center gap-3">
							<input type="checkbox" name="confirm" required class="checkbox" />
							<span>{t(data.locale, 'night.confirm_redraw')}</span>
						</label>
						<button class="btn btn-outline min-h-11 w-full sm:w-auto sm:self-start">
							<RotateCcw class="size-4" />{t(data.locale, 'night.redraw')}
						</button>
						<p class="text-sm text-base-content/70">{t(data.locale, 'night.redraw_hint')}</p>
					</form>
				{/if}
			{/if}

			<form method="POST" action="?/cancel" class="mt-2 flex flex-col gap-1">
				<label class="flex min-h-11 cursor-pointer items-center gap-3">
					<input type="checkbox" name="confirm" required class="checkbox" />
					<span>{t(data.locale, 'night.confirm_cancel')}</span>
				</label>
				<button class="btn btn-ghost min-h-11 w-full text-error sm:w-auto sm:self-start">
					<CircleX class="size-4" />{t(data.locale, 'night.cancel')}
				</button>
			</form>
		</div>
	</section>
{/if}
