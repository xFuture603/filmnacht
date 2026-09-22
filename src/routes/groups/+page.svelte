<script lang="ts">
	import { t } from '$lib/i18n';
	let { data, form } = $props();
</script>

<h1 class="mb-4 text-2xl font-bold">{t(data.locale, 'groups.title')}</h1>

{#if data.groups.length === 0}
	<p class="mb-4">{t(data.locale, 'groups.empty')}</p>
{:else}
	<ul class="menu bg-base-100 mb-6 rounded-box">
		{#each data.groups as group (group.id)}
			<li>
				<a href="/groups/{group.id}" class="min-h-11">
					<span aria-hidden="true">{group.emoji ?? '🎬'}</span>
					{group.name}
				</a>
			</li>
		{/each}
	</ul>
{/if}

{#if form?.error}
	<div class="alert alert-error mb-4" role="alert">{t(data.locale, form.error)}</div>
{/if}

<form method="POST" action="?/create" class="flex flex-col gap-3">
	<label class="form-control">
		<span class="label-text">{t(data.locale, 'groups.name')}</span>
		<input name="name" required maxlength="60" class="input input-bordered min-h-11" />
	</label>
	<label class="form-control">
		<span class="label-text">{t(data.locale, 'groups.emoji')}</span>
		<input name="emoji" maxlength="8" class="input input-bordered min-h-11 w-24" />
	</label>
	<button class="btn btn-primary min-h-11">{t(data.locale, 'groups.create')}</button>
</form>
