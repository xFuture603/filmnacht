<script lang="ts">
	import { t } from '$lib/i18n';
	import PageHeader from '$lib/components/PageHeader.svelte';
	import GroupTabs from '$lib/components/GroupTabs.svelte';
	import Poster from '$lib/components/Poster.svelte';
	import EmptyState from '$lib/components/EmptyState.svelte';
	import Icon from '$lib/components/Icon.svelte';
	let { data, form } = $props();
</script>

<PageHeader title={data.group.name} emoji="👥" />
<GroupTabs
	groupId={data.group.groupId}
	groupName={data.group.name}
	active="pool"
	locale={data.locale}
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
			<Icon name="plus" class="size-5" />{t(data.locale, 'pool.add')}
		</a>
	</div>

	{#if data.pool.length === 0}
		<EmptyState icon="film" text={t(data.locale, 'pool.empty')} />
	{:else}
		<ul class="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4">
			{#each data.pool as entry (entry.suggestionId)}
				<li class="flex min-w-0 flex-col gap-2">
					<Poster src={entry.posterUrl} />
					<div class="min-w-0">
						<p class="line-clamp-2 font-medium break-words">{entry.title}</p>
						<p class="text-sm text-base-content/70">
							{entry.year ?? ''}{entry.runtime ? ` · ${entry.runtime} min` : ''}
						</p>
						<div class="mt-1 flex flex-wrap gap-1">
							{#if entry.status === 'drawn'}
								<span class="badge badge-sm badge-neutral">{t(data.locale, 'pool.drawn')}</span>
							{/if}
							{#if entry.mine}
								<span class="badge badge-sm badge-primary">{t(data.locale, 'pool.yours')}</span>
							{/if}
						</div>
						{#if entry.mine && entry.status === 'open'}
							<form method="POST" action="?/withdraw">
								<input type="hidden" name="suggestionId" value={entry.suggestionId} />
								<button
									class="btn btn-ghost btn-sm mt-1 min-h-11 px-2 text-base-content/70"
									aria-label={t(data.locale, 'pool.withdraw_named', { title: entry.title })}
								>
									{t(data.locale, 'pool.withdraw')}
								</button>
							</form>
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
