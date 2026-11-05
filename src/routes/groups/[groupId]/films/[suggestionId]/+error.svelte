<script lang="ts">
	import { page } from '$app/state';
	import { t, type Locale } from '$lib/i18n';
	import ErrorMessage from '$lib/components/ErrorMessage.svelte';
	import PageHeader from '$lib/components/PageHeader.svelte';

	// A shared link lands here. Everyone who cannot see the group gets the same
	// page, whether or not the group or film exists: a guessed link reveals
	// nothing. A member whose film has gone (see +page.server.ts) gets the plain
	// not-found page, and so does any other error.
	const locale = (page.data?.locale ?? 'en') as Locale;
	const signedOut = $derived(page.status === 401);
	const outsider = $derived(signedOut || (page.status === 404 && page.error?.message !== 'gone'));
</script>

{#if outsider}
	<div class="mx-auto flex max-w-md flex-col items-center gap-4 py-12 text-center">
		<PageHeader title={t(locale, 'film.invite_title')} />
		<p class="text-lg">{t(locale, 'film.invite_text')}</p>
		{#if signedOut}
			<p class="text-base-content/70">{t(locale, 'film.invite_member')}</p>
			<a
				class="btn btn-primary min-h-12"
				href="/login?redirectTo={encodeURIComponent(page.url.pathname)}"
				>{t(locale, 'login.submit')}</a
			>
		{:else}
			<a class="btn btn-primary min-h-12" href="/">{t(locale, 'error.home')}</a>
		{/if}
	</div>
{:else}
	<ErrorMessage />
{/if}
