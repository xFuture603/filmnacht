<script lang="ts">
	import { locales, t, type Locale } from '$lib/i18n';
	let {
		locale,
		pathname,
		class: className = ''
	}: { locale: Locale; pathname: string; class?: string } = $props();
</script>

<form method="POST" action="/locale" class={className}>
	<input type="hidden" name="redirectTo" value={pathname} />
	<select
		name="locale"
		class="select min-h-12 w-auto"
		aria-label={t(locale, 'nav.language')}
		onchange={(e) => e.currentTarget.form?.requestSubmit()}
	>
		{#each locales as l (l)}
			<option value={l} selected={l === locale}>{l.toUpperCase()}</option>
		{/each}
	</select>
	<noscript><button class="btn min-h-12">{t(locale, 'common.save')}</button></noscript>
</form>
