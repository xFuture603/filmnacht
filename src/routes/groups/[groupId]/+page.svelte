<script lang="ts">
	import { t } from '$lib/i18n';
	import PageHeader from '$lib/components/PageHeader.svelte';
	import GroupTabs from '$lib/components/GroupTabs.svelte';
	import Poster from '$lib/components/Poster.svelte';
	import EmptyState from '$lib/components/EmptyState.svelte';
	import { Film, Plus, Users, X } from '@lucide/svelte';
	import { onMount } from 'svelte';
	import { SvelteSet } from 'svelte/reactivity';
	import { invalidateAll } from '$app/navigation';
	import { startLiveRefresh } from '$lib/live-refresh';
	let { data, form } = $props();

	onMount(() => startLiveRefresh(invalidateAll));
	// Each refresh counts as a visit, so the server stops calling a film new.
	// Keep its badge for as long as this page stays open.
	const shownNew = new SvelteSet<string>();
	$effect(() => {
		for (const entry of data.pool) if (entry.isNew) shownNew.add(entry.suggestionId);
	});
</script>

<PageHeader title={data.group.name} icon={Users} />
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

<section class="mb-8">
	<div class="mb-4 flex flex-wrap items-center justify-between gap-3">
		<p class="text-sm text-base-content/70">
			{t(data.locale, 'pool.count', { used: data.used, max: data.max })}
		</p>
		<a class="btn btn-primary min-h-11" href="/groups/{data.group.groupId}/add">
			<Plus class="size-4" strokeWidth={2.5} />{t(data.locale, 'pool.add')}
		</a>
	</div>

	{#if data.pool.length === 0}
		<EmptyState icon={Film} text={t(data.locale, 'pool.empty')} />
	{:else}
		<ul class="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4">
			{#each data.pool as entry (entry.suggestionId)}
				<li class="flex min-w-0 flex-col gap-2">
					<div class="relative">
						<Poster src={entry.posterUrl} />
						{#if entry.mine}
							<span class="badge badge-sm badge-primary absolute top-2 left-2 shadow-sm">
								{t(data.locale, 'pool.yours')}
							</span>
						{/if}
						{#if entry.isNew || shownNew.has(entry.suggestionId)}
							<span class="badge badge-sm badge-primary absolute top-2 right-2 shadow-sm">
								{t(data.locale, 'new.badge')}
							</span>
						{/if}
						{#if entry.mine && entry.status === 'open'}
							<!-- A 44px tap area around a 32px red dot: easy to hit, small on the poster. -->
							<form method="POST" action="?/withdraw" class="absolute top-0 right-0">
								<input type="hidden" name="suggestionId" value={entry.suggestionId} />
								<button
									class="group grid size-11 cursor-pointer place-items-center rounded-full focus-visible:outline-2 focus-visible:outline-offset-[-4px] focus-visible:outline-error"
									aria-label={t(data.locale, 'pool.withdraw_named', { title: entry.title })}
									title={t(data.locale, 'pool.withdraw')}
								>
									<span
										class="grid size-8 place-items-center rounded-full bg-error text-error-content shadow-md transition group-hover:scale-110"
									>
										<X class="size-4" strokeWidth={2.5} />
									</span>
								</button>
							</form>
						{/if}
					</div>
					<div class="flex min-w-0 flex-col items-start">
						<p class="line-clamp-2 font-medium break-words">{entry.title}</p>
						<p class="text-sm text-base-content/70">
							{entry.year ?? ''}{entry.runtime ? ` · ${entry.runtime} min` : ''}
						</p>
						{#if entry.status === 'drawn'}
							<span class="mt-1 badge badge-sm badge-neutral">{t(data.locale, 'pool.drawn')}</span>
						{/if}
					</div>
				</li>
			{/each}
		</ul>
	{/if}
</section>

<section class="card border border-base-300 bg-base-100 shadow-sm">
	<div class="card-body">
		<h2 class="card-title text-lg">{t(data.locale, 'groups.members')}</h2>
		<ul class="divide-y divide-base-300">
			{#each data.members as member (member.id)}
				<li class="flex min-h-11 items-center justify-between gap-2 py-2">
					<span class="min-w-0 truncate">{member.displayName}</span>
					{#if member.role === 'owner'}
						<span class="badge badge-sm">{t(data.locale, 'groups.owner')}</span>
					{/if}
				</li>
			{/each}
		</ul>

		{#if data.group.role === 'owner'}
			<form method="POST" action="?/invite" class="mt-2">
				<button class="btn btn-outline min-h-11 w-full sm:w-auto"
					>{t(data.locale, 'invite.create')}</button
				>
			</form>
			{#if form?.inviteUrl}
				<p class="mt-2 text-sm">{t(data.locale, 'invite.created')}</p>
				<input class="input min-h-11 w-full font-mono text-sm" readonly value={form.inviteUrl} />
			{/if}
		{/if}
	</div>
</section>
