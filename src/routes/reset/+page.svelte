<script lang="ts">
	import { t } from '$lib/i18n';
	let { data, form } = $props();
</script>

<h1 class="mb-4 text-2xl font-bold">{t(data.locale, 'reset.title')}</h1>

{#if form?.error}
	<div class="alert alert-error mb-4" role="alert">{t(data.locale, form.error)}</div>
{/if}
{#if form?.success}
	<div class="alert alert-success mb-4" role="alert">{t(data.locale, form.success)}</div>
{/if}

{#if data.mailConfigured}
	<form method="POST" class="flex flex-col gap-3">
		<label class="form-control">
			<span class="label-text">{t(data.locale, 'reset.email')}</span>
			<input
				name="email"
				type="email"
				required
				maxlength="254"
				autocomplete="email"
				class="input input-bordered min-h-11"
			/>
		</label>

		<button class="btn btn-primary min-h-11 self-start">{t(data.locale, 'reset.submit')}</button>
	</form>
{:else}
	<!-- No form at all: this instance has nothing to send, and a form that
	     accepted an address and then said nothing useful would be a worse lie
	     than saying so plainly. The action still answers identically if one is
	     submitted anyway. -->
	<p>{t(data.locale, 'reset.no_mail')}</p>
{/if}
