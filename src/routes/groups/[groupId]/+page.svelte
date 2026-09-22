<script lang="ts">
	import { t } from '$lib/i18n';
	let { data, form } = $props();
</script>

<h1 class="mb-4 text-2xl font-bold">
	<span aria-hidden="true">{data.group.emoji ?? '🎬'}</span>
	{data.group.name}
</h1>

<section class="mb-8">
	<div class="mb-3 flex flex-wrap items-center gap-3">
		<h2 class="text-lg font-semibold">{t(data.locale, 'pool.title')}</h2>
		<span class="text-sm opacity-70">
			{t(data.locale, 'pool.count', { used: data.used, max: data.max })}
		</span>
		<a class="btn btn-primary btn-sm min-h-11" href="/groups/{data.group.groupId}/add">
			{t(data.locale, 'pool.add')}
		</a>
	</div>

	{#if form?.error}
		<div class="alert alert-error mb-3" role="alert">{t(data.locale, form.error)}</div>
	{/if}

	{#if data.pool.length === 0}
		<p>{t(data.locale, 'pool.empty')}</p>
	{:else}
		<ul class="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4">
			{#each data.pool as entry (entry.suggestionId)}
				<li class="card bg-base-100 shadow-sm">
					{#if entry.posterUrl}
						<img
							class="aspect-[2/3] w-full rounded-t-box object-cover"
							src={entry.posterUrl}
							alt={entry.title}
							loading="lazy"
						/>
					{:else}
						<div
							class="bg-base-300 flex aspect-[2/3] w-full items-center justify-center rounded-t-box p-2 text-center text-sm"
						>
							{t(data.locale, 'pool.no_poster')}
						</div>
					{/if}
					<div class="card-body gap-1 p-3">
						<p class="font-medium">{entry.title}</p>
						<p class="text-sm opacity-70">
							{entry.year ?? ''}{entry.runtime ? ` · ${entry.runtime} min` : ''}
						</p>
						{#if entry.status === 'drawn'}
							<span class="badge badge-sm">{t(data.locale, 'pool.drawn')}</span>
						{/if}
						{#if entry.mine}
							<span class="badge badge-primary badge-sm">{t(data.locale, 'pool.yours')}</span>
							{#if entry.status === 'open'}
								<form method="POST" action="?/withdraw">
									<input type="hidden" name="suggestionId" value={entry.suggestionId} />
									<button class="btn btn-ghost btn-sm mt-1 min-h-11 w-full">
										{t(data.locale, 'pool.withdraw')}
									</button>
								</form>
							{/if}
						{/if}
					</div>
				</li>
			{/each}
		</ul>
	{/if}
</section>

<h2 class="mb-2 text-lg font-semibold">{t(data.locale, 'groups.members')}</h2>
<ul class="list-disc pl-6">
	{#each data.members as member (member.id)}
		<li>
			{member.displayName}
			{#if member.role === 'owner'}<span class="badge badge-sm ml-1"
					>{t(data.locale, 'groups.owner')}</span
				>{/if}
		</li>
	{/each}
</ul>

{#if data.group.role === 'owner'}
	<form method="POST" action="?/invite" class="mt-6">
		<button class="btn btn-secondary min-h-11">{t(data.locale, 'invite.create')}</button>
	</form>
	{#if form?.error}
		<div class="alert alert-error mt-2" role="alert">{t(data.locale, form.error)}</div>
	{/if}
	{#if form?.inviteUrl}
		<p class="mt-2">{t(data.locale, 'invite.created')}</p>
		<input class="input input-bordered mt-1 w-full min-h-11" readonly value={form.inviteUrl} />
	{/if}
{/if}
