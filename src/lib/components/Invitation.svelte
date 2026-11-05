<script lang="ts">
	import { t, type Locale } from '$lib/i18n';
	import PageHeader from '$lib/components/PageHeader.svelte';

	let {
		locale,
		loginPath = null,
		preview = null,
		question = null
	}: {
		locale: Locale;
		/** Where a signed-out visitor returns after signing in; signed in, there is only the way home. */
		loginPath?: string | null;
		/** Only for the app building a link preview: never on the page itself. */
		preview?: { title: string; image: string | null } | null;
		question?: string | null;
	} = $props();
</script>

<svelte:head>
	<meta name="robots" content="noindex" />
	{#if preview}
		<meta property="og:title" content={preview.title} />
		{#if question}<meta property="og:description" content={question} />{/if}
		{#if preview.image}<meta property="og:image" content={preview.image} />{/if}
	{/if}
</svelte:head>

<div class="mx-auto flex max-w-md flex-col items-center gap-4 py-12 text-center">
	<PageHeader title={t(locale, 'film.invite_title')} />
	<p class="text-lg">{t(locale, 'film.invite_text')}</p>
	{#if loginPath}
		<p class="text-base-content/70">{t(locale, 'film.invite_member')}</p>
		<a class="btn btn-primary min-h-12" href="/login?redirectTo={encodeURIComponent(loginPath)}"
			>{t(locale, 'login.submit')}</a
		>
	{:else}
		<a class="btn btn-primary min-h-12" href="/">{t(locale, 'error.home')}</a>
	{/if}
</div>
