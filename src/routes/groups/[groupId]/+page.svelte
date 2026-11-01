<script lang="ts">
	import CopyField from '$lib/components/CopyField.svelte';
	import { enhance } from '$app/forms';
	import { t } from '$lib/i18n';
	import NewBadge from '$lib/components/NewBadge.svelte';
	import ConfirmButton from '$lib/components/ConfirmButton.svelte';
	import PageHeader from '$lib/components/PageHeader.svelte';
	import GroupTabs from '$lib/components/GroupTabs.svelte';
	import Poster from '$lib/components/Poster.svelte';
	import EmptyState from '$lib/components/EmptyState.svelte';
	import {
		CalendarDays,
		ChevronDown,
		ChevronRight,
		Film,
		MapPin,
		Plus,
		Star,
		X
	} from '@lucide/svelte';
	import { onMount } from 'svelte';
	import { SvelteSet } from 'svelte/reactivity';
	import { afterNavigate, invalidateAll, replaceState } from '$app/navigation';
	import { page } from '$app/state';
	import Toast from '$lib/components/Toast.svelte';
	import { startLiveRefresh, whenReachable } from '$lib/live-refresh';
	let { data, form } = $props();

	onMount(() => startLiveRefresh(whenReachable(invalidateAll)));
	// Sent here by an invite to this group: say so once, then drop the marker so
	// a reload does not say it again.
	const already = page.url.searchParams.has('already');
	// On the first load SvelteKit runs afterNavigate just before it marks its
	// router started, in the same synchronous step, and replaceState throws until
	// then: one microtask later is the earliest safe moment.
	afterNavigate(() => {
		if (!page.url.searchParams.has('already')) return;
		queueMicrotask(() => replaceState(page.url.pathname, page.state));
	});
	// Each refresh counts as a visit, so the server stops calling a film new.
	// Keep its badge for as long as this page stays open.
	const shownNew = new SvelteSet<string>();
	// One row on a computer, two on a phone: enough history without the page
	// growing by a tile every movie night.
	const DRAWN_SHOWN = 4;

	const answers = ['yes', 'maybe', 'no'] as const;
	const lists = $derived([
		{ id: 'pool', label: t(data.locale, 'pool.tab_pool'), count: data.pool.length },
		{ id: 'drawn', label: t(data.locale, 'pool.tab_drawn'), count: data.drawn.length },
		{ id: 'members', label: t(data.locale, 'pool.tab_members'), count: data.members.length }
	]);
	// An answer from the members list (invite link, leaving) shows that list.
	const current = $derived(
		form?.inviteUrl || form?.confirm === 'leave'
			? 'members'
			: (lists.find((l) => l.id === page.url.searchParams.get('list'))?.id ?? 'pool')
	);
	$effect(() => {
		for (const entry of data.pool) if (entry.isNew) shownNew.add(entry.suggestionId);
	});
</script>

{#if already}
	<Toast message={t(data.locale, 'invite.already_member')} locale={data.locale} />
{/if}

<PageHeader title={data.group.name} />
<GroupTabs
	groupId={data.group.groupId}
	groupName={data.group.name}
	active="pool"
	locale={data.locale}
	isOwner={data.group.role === 'owner'}
	counts={data.newCounts}
/>

{#if form?.error}
	<div class="alert alert-error alert-soft mb-4" role="alert">{t(data.locale, form.error)}</div>
{/if}

{#each data.toRate as night, i (night.id)}
	<section class="card mb-4 border border-base-300 bg-base-100 shadow-sm">
		<div class="card-body flex-row flex-wrap items-center gap-4">
			<span
				class="grid size-11 shrink-0 place-items-center rounded-field bg-base-200 text-base-content"
			>
				<Star class="size-5" />
			</span>
			<div class="min-w-0 flex-1">
				<h2 class="text-lg font-bold break-words">
					{t(data.locale, 'rate.title', { title: night.title })}
				</h2>
				<p class="text-sm text-base-content/70">
					{t(data.locale, 'rate.before', { day: night.closes })}
				</p>
			</div>
			<a
				class={['btn min-h-12 w-full sm:w-auto', i === 0 ? 'btn-primary' : 'btn-outline']}
				href="/groups/{data.group.groupId}/nights/{night.id}">{t(data.locale, 'rate.now')}</a
			>
		</div>
	</section>
{/each}

{#if data.next}
	{@const next = data.next}
	<section class="card mb-6 border border-base-300 bg-base-100 shadow-sm">
		<div class="card-body gap-4">
			<div class="flex items-center gap-4 sm:gap-6">
				<div class="w-20 shrink-0 sm:w-28">
					<Poster src={next.film?.posterUrl ?? null} />
				</div>
				<div class="flex min-w-0 flex-1 flex-col gap-1">
					<p class="text-sm text-base-content/70">{t(data.locale, 'next.title')}</p>
					<h2 class="text-xl font-bold break-words sm:text-2xl">
						<a
							class="hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-base-content"
							href="/groups/{data.group.groupId}/nights/{next.id}"
						>
							{#if next.film}
								{next.film.title}
								{#if next.film.year}
									<span class="font-normal text-base-content/60">({next.film.year})</span>
								{/if}
							{:else if next.filmHidden}
								{t(data.locale, 'next.surprise')}
							{:else}
								{t(data.locale, 'next.not_drawn')}
							{/if}
							<ChevronRight class="inline size-5 align-[-0.15em]" />
						</a>
					</h2>
					<p class="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
						<span class="inline-flex items-center gap-1"
							><CalendarDays class="size-4 shrink-0" />{next.when}</span
						>
						{#if next.location}
							<span class="inline-flex min-w-0 items-center gap-1"
								><MapPin class="size-4 shrink-0" /><span class="truncate">{next.location}</span
								></span
							>
						{/if}
					</p>
				</div>
			</div>
			<!-- Answer in place: the night's own action, so nothing to keep in step.
			     Without JavaScript the browser lands on the night page, answered. -->
			<div class="flex flex-col gap-2">
				<p class="text-sm text-base-content/70">
					{t(data.locale, `next.you.${next.myResponse ?? 'none'}`)}
				</p>
				<form
					method="POST"
					action="/groups/{data.group.groupId}/nights/{next.id}?/respond"
					class="join w-full"
					use:enhance={() =>
						async ({ update }) => {
							await update({ reset: false });
						}}
				>
					{#each answers as answer (answer)}
						<button
							name="response"
							value={answer}
							aria-pressed={next.myResponse === answer}
							class={[
								'btn join-item h-auto min-h-12 flex-1 px-2 py-2 leading-tight',
								next.myResponse === answer ? 'btn-primary' : 'btn-outline'
							]}
						>
							{t(data.locale, `nights.rsvp.${answer}`)}
						</button>
					{/each}
				</form>
			</div>
		</div>
	</section>
{/if}

<!-- One list at a time: the switch is links, so a reload, the back button and a
     browser without JavaScript all keep the chosen list. -->
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

<section class="mb-8" hidden={current !== 'pool'} aria-labelledby="list-pool">
	<h2 id="list-pool" class="sr-only">{t(data.locale, 'pool.in_pool')}</h2>

	<div class="mb-4 flex flex-wrap items-center justify-between gap-3">
		{#if data.used >= data.max}
			<!-- Disabled, with the reason beside it: a greyed-out button alone
			     leaves people guessing. -->
			<p class="text-sm text-base-content/70">
				{t(data.locale, 'pool.count_full', { max: data.max })}
			</p>
			<button type="button" class="btn min-h-12" disabled>
				<Plus class="size-4" strokeWidth={2.5} />{t(data.locale, 'pool.add')}
			</button>
		{:else}
			<p class="text-sm text-base-content/70">
				{t(data.locale, 'pool.count', { used: data.used, max: data.max })}
			</p>
			<!-- One primary action per screen: a due rating outranks adding a film. -->
			<a
				class={['btn min-h-12', data.toRate.length > 0 ? 'btn-outline' : 'btn-primary']}
				href="/groups/{data.group.groupId}/add"
			>
				<Plus class="size-4" strokeWidth={2.5} />{t(data.locale, 'pool.add')}
			</a>
		{/if}
	</div>

	{#if data.pool.length === 0}
		<EmptyState
			icon={Film}
			text={t(data.locale, data.drawn.length > 0 ? 'pool.empty_again' : 'pool.empty')}
		/>
	{:else}
		<ul class="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4">
			{#each data.pool as entry (entry.suggestionId)}
				{@render tile(entry)}
			{/each}
		</ul>
	{/if}
</section>

<section class="mb-8" hidden={current !== 'drawn'} aria-labelledby="list-drawn">
	<h2 id="list-drawn" class="sr-only">{t(data.locale, 'pool.drawn_heading')}</h2>
	{#if data.drawn.length === 0}
		<EmptyState icon={Film} text={t(data.locale, 'pool.drawn_none')} />
	{:else}
		<ul class="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4">
			{#each data.drawn.slice(0, DRAWN_SHOWN) as entry (entry.suggestionId)}
				{@render tile(entry)}
			{/each}
		</ul>
		{#if data.drawn.length > DRAWN_SHOWN}
			{@const earlier = data.drawn.length - DRAWN_SHOWN}
			<details class="group mt-4">
				<summary class="btn btn-outline min-h-12 list-none">
					<ChevronDown class="size-4 transition-transform group-open:rotate-180" />
					<span class="group-open:hidden"
						>{earlier === 1
							? t(data.locale, 'pool.earlier_one')
							: t(data.locale, 'pool.earlier', { count: earlier })}</span
					>
					<span class="hidden group-open:inline">{t(data.locale, 'pool.earlier_hide')}</span>
				</summary>
				<ul class="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4">
					{#each data.drawn.slice(DRAWN_SHOWN) as entry (entry.suggestionId)}
						{@render tile(entry)}
					{/each}
				</ul>
			</details>
		{/if}
	{/if}
</section>

<div class="mb-8" hidden={current !== 'members'}>
	<section class="card border border-base-300 bg-base-100 shadow-sm" aria-labelledby="list-members">
		<h2 id="list-members" class="sr-only">{t(data.locale, 'groups.members')}</h2>
		<div class="card-body">
			<ul class="divide-y divide-base-300">
				{#each data.members as member (member.id)}
					<li class="flex min-h-12 items-center justify-between gap-2 py-2">
						<span class="min-w-0 truncate">{member.displayName}</span>
						{#if member.role === 'owner'}
							<span class="badge badge-sm badge-outline">{t(data.locale, 'groups.owner')}</span>
						{/if}
					</li>
				{/each}
			</ul>

			{#if data.group.role === 'owner'}
				<!-- Enhanced: the page stays where it is instead of jumping to the top. -->
				<form method="POST" action="?/invite" class="mt-2" use:enhance>
					<button class="btn btn-outline min-h-12 w-full sm:w-auto"
						>{t(data.locale, 'invite.create')}</button
					>
				</form>
				{#if form?.inviteUrl}
					<p class="mt-2 text-sm">{t(data.locale, 'invite.created')}</p>
					{#key form.inviteUrl}
						<CopyField
							value={form.inviteUrl}
							label={t(data.locale, 'invite.link_label')}
							copyLabel={t(data.locale, 'common.copy')}
							copiedLabel={t(data.locale, 'common.copied')}
							autoCopy
						/>
					{/key}
				{/if}
			{:else}
				<form
					method="POST"
					action="?list=members&/leave"
					class="mt-2 flex flex-col gap-2 border-t border-base-300 pt-4"
				>
					<p class="text-sm text-base-content/70">{t(data.locale, 'groups.leave_hint')}</p>
					<div class="mt-2 flex flex-col gap-2 sm:flex-row">
						<ConfirmButton
							destructive
							armed={form?.confirm === 'leave'}
							armedLabel={t(data.locale, 'confirm.again')}
							class="btn btn-outline min-h-12 w-full sm:w-auto "
						>
							{t(data.locale, 'groups.leave')}
						</ConfirmButton>
					</div>
				</form>
			{/if}
		</div>
	</section>
</div>

{#snippet tile(entry: (typeof data.pool)[number])}
	<!-- The title's link stretches over the whole tile (after:inset-0), so the
		     poster opens the film too with one tab stop; the withdraw form sits above it. -->
	<li class="group/tile relative isolate flex min-w-0 flex-col gap-2">
		<!-- Hover (only on devices that can hover) and keyboard focus lift the
			     poster the same way: a shadow and a thin neutral ring, never amber. -->
		<div
			class="relative rounded-box transition-shadow duration-150 group-hover/tile:shadow-md group-hover/tile:ring-1 group-hover/tile:ring-base-content/50 group-has-[a:focus-visible]/tile:shadow-md group-has-[a:focus-visible]/tile:ring-1 group-has-[a:focus-visible]/tile:ring-base-content/50"
		>
			<Poster src={entry.posterUrl} />
			{#if entry.mine}
				<span class="badge badge-sm absolute top-2 left-2 border-base-300 bg-base-100 shadow-sm">
					{t(data.locale, 'pool.yours')}
				</span>
			{/if}
			{#if entry.status === 'open' && (entry.isNew || shownNew.has(entry.suggestionId))}
				<NewBadge label={t(data.locale, 'new.badge')} class="absolute top-2 right-2 shadow-sm" />
			{/if}
			{#if entry.mine && entry.status === 'open'}
				<!-- A 48px tap area around a 32px chip: easy to hit, small on the poster.
					     Neutral like the "Yours" badge, not red: a trigger stays low-key.
					     The focus ring has a light gap so it shows on any poster. -->
				<form method="POST" action="?/withdraw" class="absolute top-0 right-0 z-10">
					<input type="hidden" name="suggestionId" value={entry.suggestionId} />
					<button
						class="group grid size-12 cursor-pointer place-items-center rounded-full focus-visible:outline-none"
						aria-label={t(data.locale, 'pool.withdraw_named', { title: entry.title })}
						title={t(data.locale, 'pool.withdraw')}
					>
						<span
							class="grid size-8 place-items-center rounded-full border border-base-300 bg-base-100 text-base-content shadow-sm transition group-hover:scale-110 group-focus-visible:ring-2 group-focus-visible:ring-base-content group-focus-visible:ring-offset-2 group-focus-visible:ring-offset-base-100"
						>
							<X class="size-4" strokeWidth={2.5} />
						</span>
					</button>
				</form>
			{/if}
		</div>
		<div class="flex min-w-0 flex-col items-start">
			<p class="line-clamp-2 font-bold break-words">
				<a
					class="after:absolute after:inset-0 after:rounded-box hover:underline focus-visible:outline-none focus-visible:after:outline-2 focus-visible:after:outline-offset-2 focus-visible:after:outline-base-content"
					href="/groups/{data.group.groupId}/films/{entry.suggestionId}">{entry.title}</a
				>
			</p>
			<p class="text-sm text-base-content/70">
				{entry.year ?? ''}{entry.runtime ? ` · ${entry.runtime} min` : ''}
			</p>
			{#if entry.drawnFor}
				<!-- h-auto + whitespace-normal: wrap rather than spill past the column. -->
				<span class="mt-1 badge h-auto badge-sm py-0.5 whitespace-normal badge-neutral"
					>{t(data.locale, 'pool.drawn_for', { when: entry.drawnFor })}</span
				>
			{:else if entry.watchedOn}
				<span class="mt-1 badge h-auto badge-sm py-0.5 whitespace-normal badge-neutral"
					>{t(data.locale, 'pool.watched_on', { when: entry.watchedOn })}</span
				>
			{:else if entry.status === 'drawn'}
				<span class="mt-1 badge badge-sm badge-neutral">{t(data.locale, 'pool.drawn')}</span>
			{/if}
		</div>
	</li>
{/snippet}
