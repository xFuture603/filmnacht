<script lang="ts">
	import { page } from '$app/state';
	import { t, type Locale } from '$lib/i18n';

	// Layout data is present for errors thrown in a page load; fall back for the
	// rarer case of an error thrown before the layout load has run.
	const locale = (page.data?.locale ?? 'en') as Locale;
	const key =
		page.status === 401
			? 'error.401'
			: page.status === 403
				? 'error.403'
				: page.status === 404
					? 'error.404'
					: 'error.generic';
</script>

<div class="mx-auto flex max-w-md flex-col items-center gap-4 py-12 text-center">
	<h1 class="text-6xl font-bold tracking-tight text-base-content/60">{page.status}</h1>
	<p class="text-lg">{t(locale, key)}</p>
	<a class="btn btn-primary min-h-11" href="/">{t(locale, 'error.home')}</a>
</div>
