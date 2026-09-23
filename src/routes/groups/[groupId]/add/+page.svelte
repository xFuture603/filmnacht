<script lang="ts">
	import { t } from '$lib/i18n';
	let { data, form } = $props();
</script>

<h1 class="mb-4 text-2xl font-bold">
	{t(data.locale, 'add.title', { group: data.group.name })}
</h1>

{#if form?.error}
	<div class="alert alert-error mb-4" role="alert">{t(data.locale, form.error)}</div>
{/if}

<h2 class="mb-2 text-lg font-semibold">{t(data.locale, 'add.manual_heading')}</h2>
<form method="POST" action="?/manual" class="mb-6 flex max-w-md flex-col gap-3">
	<label class="form-control">
		<span class="label-text">{t(data.locale, 'add.film_title')}</span>
		<input name="title" required maxlength="200" class="input input-bordered min-h-11" />
	</label>
	<label class="form-control">
		<span class="label-text">{t(data.locale, 'add.year')}</span>
		<input name="year" inputmode="numeric" maxlength="4" class="input input-bordered min-h-11" />
	</label>
	<label class="form-control">
		<span class="label-text">{t(data.locale, 'add.poster')}</span>
		<input name="posterUrl" type="url" class="input input-bordered min-h-11" />
	</label>
	<label class="form-control">
		<span class="label-text">{t(data.locale, 'add.note')}</span>
		<textarea name="note" maxlength={data.noteMax} rows="2" class="textarea textarea-bordered"
		></textarea>
		<span class="label-text-alt">{t(data.locale, 'add.note_hint')}</span>
	</label>
	<button class="btn btn-primary min-h-11">{t(data.locale, 'add.submit')}</button>
</form>

<a class="btn btn-ghost min-h-11" href="/groups/{data.group.groupId}">
	{t(data.locale, 'add.back')}
</a>
