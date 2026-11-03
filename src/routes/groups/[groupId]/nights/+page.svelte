<script lang="ts">
	import { t } from '$lib/i18n';
	import NewBadge from '$lib/components/NewBadge.svelte';
	import PageHeader from '$lib/components/PageHeader.svelte';
	import GroupTabs from '$lib/components/GroupTabs.svelte';
	import EmptyState from '$lib/components/EmptyState.svelte';
	import NightStatus from '$lib/components/NightStatus.svelte';
	import Poster from '$lib/components/Poster.svelte';
	import { CalendarDays, MapPin, Plus, Star } from '@lucide/svelte';
	import { onMount } from 'svelte';
	import { SvelteSet } from 'svelte/reactivity';
	import { invalidateAll } from '$app/navigation';
	import { page } from '$app/state';
	import { startLiveRefresh, whenReachable } from '$lib/live-refresh';
	let { data } = $props();

	onMount(() => startLiveRefresh(whenReachable(invalidateAll)));
	// Each refresh counts as a visit, so the server stops calling a night new.
	// Keep its badge for as long as this page stays open.
	const shownNew = new SvelteSet<string>();
	$effect(() => {
		for (const night of [...data.upcoming, ...data.past]) if (night.isNew) shownNew.add(night.id);
	});

	const lists = $derived([
		{ id: 'upcoming', label: t(data.locale, 'nights.upcoming'), count: data.upcoming.length },
		{ id: 'past', label: t(data.locale, 'nights.past'), count: data.past.length }
	]);
	const current = $derived(
		lists.find((l) => l.id === page.url.searchParams.get('list'))?.id ?? 'upcoming'
	);

	const fmt = (n: number) =>
		new Intl.NumberFormat(data.locale === 'de' ? 'de-DE' : 'en-GB', {
			minimumFractionDigits: 1,
			maximumFractionDigits: 1
		}).format(n);
</script>

<PageHeader title={data.group.name} />
<GroupTabs
	groupId={data.group.groupId}
	groupName={data.group.name}
	active="nights"
	locale={data.locale}
	isOwner={data.isOwner}
	counts={data.newCounts}
/>

<!-- One list at a time, as on the pool page: links, so a reload, the back
     button and a browser without JavaScript all keep the chosen list. -->
<nav class="mb-4 flex border-b border-base-300" aria-label={t(data.locale, 'pool.lists')}>
	{#each lists as list (list.id)}
		<a
			href="?list={list.id}"
			data-sveltekit-noscroll
			data-sveltekit-replacestate
			aria-current={current === list.id ? 'page' : undefined}
			class={[
				'-mb-px flex min-h-12 flex-1 items-center justify-center gap-1.5 border-b-2 px-2 text-center font-bold',
				'focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-base-content',
				current === list.id
					? 'border-base-content text-base-content'
					: 'border-transparent text-base-content/70 hover:text-base-content'
			]}
		>
			{list.label}
			<span class="text-sm font-normal text-base-content/70">{list.count}</span>
		</a>
	{/each}
</nav>

{#snippet list(nights: typeof data.upcoming, upcoming: boolean)}
	<ul class="grid gap-4">
		{#each nights as night (night.id)}
			<li>
				<a
					href="/groups/{data.group.groupId}/nights/{night.id}"
					class="card flex min-h-12 w-full flex-row items-center gap-4 bg-base-100 p-4 transition-colors sm:gap-6 sm:p-6 hover:bg-base-content/5"
				>
					<div class="w-16 shrink-0">
						<Poster src={night.film?.posterUrl ?? null} />
					</div>
					<div class="flex min-w-0 flex-1 flex-col gap-1">
						<span class="font-bold break-words">
							{night.film
								? night.film.title
								: t(data.locale, night.filmHidden ? 'nights.surprise' : 'next.not_drawn')}
						</span>
						<span class="flex items-center gap-1 text-sm">
							<CalendarDays class="size-4 shrink-0" />{night.when}
						</span>
						{#if night.location}
							<span class="flex items-center gap-1 text-sm text-base-content/70">
								<MapPin class="size-4 shrink-0" /><span class="min-w-0 break-words"
									>{night.location}</span
								>
							</span>
						{/if}
						{#if upcoming}
							<!-- Who is coming matters ahead of the night; afterwards its page keeps it. -->
							<span class="text-sm text-base-content/70">
								{t(data.locale, 'nights.counts', {
									yes: night.yes,
									maybe: night.maybe,
									no: night.no
								})}
							</span>
						{/if}
						<span class="mt-1 flex flex-wrap items-center gap-2">
							<NightStatus status={night.status} locale={data.locale} />
							{#if night.average !== null}
								<span class="badge badge-outline gap-1 tabular-nums">
									<Star class="size-4" />
									<span class="sr-only">{t(data.locale, 'ratings.average')}</span>
									{t(data.locale, 'ratings.average_short', { average: fmt(night.average) })}
								</span>
							{/if}
							{#if night.isNew || shownNew.has(night.id)}
								<NewBadge label={t(data.locale, 'new.badge')} />
							{/if}
						</span>
					</div>
				</a>
			</li>
		{/each}
	</ul>
{/snippet}

<section class="mb-8" hidden={current !== 'upcoming'} aria-labelledby="list-upcoming">
	<h2 id="list-upcoming" class="sr-only">{t(data.locale, 'nights.upcoming')}</h2>
	<div class="mb-4 flex justify-end">
		<a class="btn btn-primary min-h-12 shrink-0" href="/groups/{data.group.groupId}/nights/new">
			<Plus class="size-4" strokeWidth={2.5} />{t(data.locale, 'nights.schedule')}
		</a>
	</div>
	{#if data.upcoming.length === 0}
		<EmptyState icon={CalendarDays} text={t(data.locale, 'nights.none')} />
	{:else}
		{@render list(data.upcoming, true)}
	{/if}
</section>

<section class="mb-8" hidden={current !== 'past'} aria-labelledby="list-past">
	<h2 id="list-past" class="sr-only">{t(data.locale, 'nights.past')}</h2>
	{#if data.past.length === 0}
		<EmptyState icon={CalendarDays} text={t(data.locale, 'nights.past_none')} />
	{:else}
		{@render list(data.past, false)}
	{/if}
</section>
