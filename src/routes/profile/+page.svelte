<script lang="ts">
	import { t } from '$lib/i18n';
	let { data, form } = $props();
</script>

<h1 class="mb-4 text-2xl font-bold">{t(data.locale, 'profile.title')}</h1>
<p class="mb-6">{data.user?.displayName}</p>

<h2 class="mb-1 text-lg font-semibold">{t(data.locale, 'profile.login_link')}</h2>
<p class="mb-2 text-sm">{t(data.locale, 'profile.login_link_hint')}</p>
<p class="mb-3 text-sm opacity-70">{t(data.locale, 'profile.reveal_warning')}</p>

<form method="POST" action="?/reveal">
	<button class="btn btn-secondary min-h-11">{t(data.locale, 'profile.reveal')}</button>
</form>

{#if form?.loginUrl}
	<label class="form-control mt-3">
		<span class="label-text">{t(data.locale, 'profile.login_link')}</span>
		<input class="input input-bordered min-h-11 w-full" readonly value={form.loginUrl} />
	</label>
{/if}

<form method="POST" action="/logout" class="mt-8">
	<button class="btn btn-ghost min-h-11">{t(data.locale, 'profile.logout')}</button>
</form>
