<script lang="ts">
	import { t } from '$lib/i18n';
	let { data, form } = $props();
</script>

<h1 class="mb-2 text-2xl font-bold">{t(data.locale, 'setup.title')}</h1>
<p class="mb-4">{t(data.locale, 'setup.intro')}</p>

{#if form?.error}
	<div class="alert alert-error mb-4" role="alert">{t(data.locale, form.error)}</div>
{/if}

<form method="POST" class="flex flex-col gap-4">
	<label class="form-control">
		<span class="label-text">{t(data.locale, 'setup.display_name')}</span>
		<input
			name="displayName"
			required
			maxlength="60"
			autocomplete="nickname"
			class="input input-bordered min-h-11"
		/>
	</label>

	<label class="form-control">
		<span class="label-text">{t(data.locale, 'setup.timezone')}</span>
		<select name="timezone" required class="select select-bordered min-h-11">
			{#each data.timezones as tz (tz)}
				<option value={tz} selected={tz === 'Europe/Berlin'}>{tz}</option>
			{/each}
		</select>
	</label>

	<button class="btn btn-primary min-h-11">{t(data.locale, 'setup.submit')}</button>
</form>
