<script lang="ts">
	import { locales, t, type Locale } from '$lib/i18n';
	import SubPage from '$lib/components/SubPage.svelte';
	import RadioRow from '$lib/components/RadioRow.svelte';
	let { data, form } = $props();

	// Each language's own name for itself, as in any language picker.
	const languageNames: Record<Locale, string> = { en: 'English', de: 'Deutsch' };
</script>

<SubPage
	locale={data.locale}
	back={{ href: '/admin', label: t(data.locale, 'nav.admin') }}
	title={t(data.locale, 'admin.email_locale')}
	{form}
	success={form?.emailLocaleSaved ? 'admin.email_locale_saved' : undefined}
	required={false}
>
	<form method="POST" action="?/emailLocale" class="mb-6 flex flex-col gap-6">
		<RadioRow
			legend={t(data.locale, 'admin.email_locale')}
			name="locale"
			value={data.emailLocale}
			options={locales.map((l) => ({ value: l, label: languageNames[l] }))}
			hint={t(data.locale, 'admin.email_locale_hint')}
		/>
		<button class="btn btn-primary min-h-12 w-full sm:w-auto sm:self-start"
			>{t(data.locale, 'admin.email_locale_save')}</button
		>
	</form>
</SubPage>
