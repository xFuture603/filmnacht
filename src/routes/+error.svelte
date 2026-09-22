<script lang="ts">
	import { page } from '$app/state';
	import { t, type Locale } from '$lib/i18n';

	// Layout data is present for errors thrown in a page load; fall back for the
	// rarer case of an error thrown before the layout load has run.
	const locale = (page.data?.locale ?? 'en') as Locale;
	const key =
		page.status === 401 ? 'error.401' : page.status === 404 ? 'error.404' : 'error.generic';
</script>

<div class="mx-auto max-w-lg p-4">
	<h1 class="mb-2 text-2xl font-bold">{page.status}</h1>
	<p class="mb-6">{t(locale, key)}</p>
	<a class="btn btn-primary min-h-11" href="/">{t(locale, 'error.home')}</a>
</div>
