<script lang="ts">
	import { t, type Locale } from '$lib/i18n';
	import PageHeader from '$lib/components/PageHeader.svelte';

	let {
		locale,
		loginHref = null
	}: {
		locale: Locale;
		/** Where a signed-out visitor signs in; signed in, there is only the way home. */
		loginHref?: string | null;
	} = $props();
</script>

<div class="mx-auto flex max-w-md flex-col items-center gap-4 py-12 text-center">
	<PageHeader title={t(locale, 'film.invite_title')} />
	<p class="text-lg">{t(locale, 'film.invite_text')}</p>
	{#if loginHref}
		<p class="text-base-content/70">{t(locale, 'film.invite_member')}</p>
		<a class="btn btn-primary min-h-12" href={loginHref}>{t(locale, 'login.submit')}</a>
	{:else}
		<a class="btn btn-primary min-h-12" href="/">{t(locale, 'error.home')}</a>
	{/if}
</div>
