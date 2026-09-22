<script lang="ts">
	import { t } from '$lib/i18n';
	let { data, form } = $props();
</script>

<h1 class="mb-4 text-2xl font-bold">
	<span aria-hidden="true">{data.group.emoji ?? '🎬'}</span>
	{data.group.name}
</h1>

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
	{#if form?.inviteUrl}
		<p class="mt-2">{t(data.locale, 'invite.created')}</p>
		<input class="input input-bordered mt-1 w-full" readonly value={form.inviteUrl} />
	{/if}
{/if}
