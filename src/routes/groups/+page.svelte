<script lang="ts">
	import RequiredNote from '$lib/components/RequiredNote.svelte';
	import { t } from '$lib/i18n';
	import NewBadge from '$lib/components/NewBadge.svelte';
	import PageHeader from '$lib/components/PageHeader.svelte';
	import EmptyState from '$lib/components/EmptyState.svelte';
	import Field from '$lib/components/Field.svelte';
	import { ChevronRight, Users } from '@lucide/svelte';
	let { data, form } = $props();
</script>

<PageHeader title={t(data.locale, 'groups.title')} />

{#if data.groups.length === 0}
	<div class="mb-8"><EmptyState icon={Users} text={t(data.locale, 'groups.empty')} /></div>
{:else}
	<ul class="mb-8 grid gap-3">
		{#each data.groups as group (group.id)}
			<li class="min-w-0">
				<a
					href="/groups/{group.id}"
					data-sveltekit-preload-data="off"
					class="card flex min-h-11 w-full flex-row items-center gap-3 border border-base-300 bg-base-100 p-4 shadow-sm transition hover:shadow-md"
				>
					<span
						class="grid size-11 shrink-0 place-items-center rounded-field bg-base-200 text-base-content"
					>
						<Users class="size-5" />
					</span>
					<span class="line-clamp-2 min-w-0 flex-1 font-semibold break-words">{group.name}</span>
					{#if group.newCount > 0}
						<NewBadge label={t(data.locale, 'new.count', { count: group.newCount })} />
					{/if}
					{#if group.role === 'owner'}
						<span class="badge badge-sm">{t(data.locale, 'groups.owner')}</span>
					{/if}
					<ChevronRight class="size-4 shrink-0 text-base-content/40" />
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
			<RequiredNote locale={data.locale} />
			<Field label={t(data.locale, 'groups.name')}>
				<input name="name" required maxlength="60" class="input min-h-11 w-full" />
			</Field>
			<button class="btn btn-primary mt-2 min-h-11 w-full sm:w-auto sm:self-start"
				>{t(data.locale, 'groups.create')}</button
			>
		</form>
	</div>
</section>
