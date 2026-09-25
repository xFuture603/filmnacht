<script lang="ts">
	import { t } from '$lib/i18n';
	import PageHeader from '$lib/components/PageHeader.svelte';
	import EmptyState from '$lib/components/EmptyState.svelte';
	import Field from '$lib/components/Field.svelte';
	let { data, form } = $props();
</script>

<PageHeader title={t(data.locale, 'groups.title')} />

{#if data.groups.length === 0}
	<div class="mb-8"><EmptyState icon="groups" text={t(data.locale, 'groups.empty')} /></div>
{:else}
	<ul class="mb-8 grid gap-3 sm:grid-cols-2">
		{#each data.groups as group (group.id)}
			<li class="min-w-0">
				<a
					href="/groups/{group.id}"
					class="card flex min-h-11 w-full flex-row items-center gap-3 border border-base-300 bg-base-100 p-4 shadow-sm transition hover:shadow-md"
				>
					<span class="text-3xl" aria-hidden="true">{group.emoji ?? '🎬'}</span>
					<span class="min-w-0 flex-1 truncate font-semibold">{group.name}</span>
					{#if group.role === 'owner'}
						<span class="badge badge-sm">{t(data.locale, 'groups.owner')}</span>
					{/if}
				</a>
			</li>
		{/each}
	</ul>
{/if}

<section class="card border border-base-300 bg-base-100 shadow-sm">
	<div class="card-body">
		<h2 class="card-title text-lg">{t(data.locale, 'groups.create')}</h2>
		{#if form?.error}
			<div class="alert alert-error alert-soft" role="alert">{t(data.locale, form.error)}</div>
		{/if}
		<form method="POST" action="?/create" class="flex flex-col gap-2">
			<Field label={t(data.locale, 'groups.name')}>
				<input name="name" required maxlength="60" class="input min-h-11 w-full" />
			</Field>
			<Field label={t(data.locale, 'groups.emoji')}>
				<input name="emoji" maxlength="8" class="input min-h-11 w-24" />
			</Field>
			<button class="btn btn-primary mt-2 min-h-11 w-full sm:w-auto sm:self-start"
				>{t(data.locale, 'groups.create')}</button
			>
		</form>
	</div>
</section>
