<script lang="ts">
	import { t } from '$lib/i18n';
	let { data, form } = $props();
</script>

{#if data.rateLimited}
	<div class="alert alert-warning" role="alert">{t(data.locale, 'invite.rate_limited')}</div>
{:else if !data.invite}
	<div class="alert alert-error" role="alert">{t(data.locale, 'invite.invalid')}</div>
{:else}
	<h1 class="mb-4 text-2xl font-bold">
		{t(data.locale, 'invite.join_title', { group: data.invite.groupName })}
	</h1>

	{#if form?.error}
		<div class="alert alert-error mb-4" role="alert">{t(data.locale, form.error)}</div>
	{/if}

	<form method="POST" class="flex flex-col gap-3">
		<label class="form-control">
			<span class="label-text">{t(data.locale, 'invite.join_name')}</span>
			<input
				name="displayName"
				required
				maxlength="60"
				autocomplete="nickname"
				class="input input-bordered min-h-11"
			/>
		</label>
		<button class="btn btn-primary min-h-11">{t(data.locale, 'invite.join_submit')}</button>
	</form>
{/if}
