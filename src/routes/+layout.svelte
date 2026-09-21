<script lang="ts">
	import '../app.css';
	import { locales, t } from '$lib/i18n';

	let { data, children } = $props();
</script>

<div class="min-h-screen bg-base-200">
	<nav class="navbar bg-base-100 shadow-sm">
		<a class="btn btn-ghost min-h-11 text-xl" href="/">{t(data.locale, 'app.name')}</a>
		<div class="flex-1"></div>
		{#if data.user}
			<a class="btn btn-ghost min-h-11" href="/groups">{t(data.locale, 'nav.groups')}</a>
			<a class="btn btn-ghost min-h-11" href="/profile">{t(data.locale, 'nav.profile')}</a>
		{/if}
		<form method="POST" action="/locale" class="ml-2">
			<input type="hidden" name="redirectTo" value={data.pathname} />
			<select
				name="locale"
				class="select min-h-11"
				aria-label={t(data.locale, 'nav.language')}
				onchange={(e) => e.currentTarget.form?.requestSubmit()}
			>
				{#each locales as locale (locale)}
					<option value={locale} selected={locale === data.locale}>{locale.toUpperCase()}</option>
				{/each}
			</select>
			<noscript><button class="btn min-h-11">{t(data.locale, 'common.save')}</button></noscript>
		</form>
	</nav>

	<main class="mx-auto max-w-3xl p-4">
		{@render children()}
	</main>
</div>
