<script lang="ts">
	import { t } from '$lib/i18n';
	import SubPage from '$lib/components/SubPage.svelte';
	import TimezoneField from '$lib/components/TimezoneField.svelte';
	let { data, form } = $props();
</script>

<SubPage
	locale={data.locale}
	back={{ href: '/admin', label: t(data.locale, 'nav.admin') }}
	title={t(data.locale, 'admin.timezone')}
	{form}
	success={form?.timezoneSaved ? 'admin.timezone_saved' : undefined}
>
	<form method="POST" action="?/timezone" class="mb-6 flex flex-col gap-6">
		<TimezoneField
			label={t(data.locale, 'admin.timezone')}
			hint={t(data.locale, 'admin.timezone_hint')}
			timezones={data.timezones}
			value={data.timezone}
		/>
		<button class="btn btn-primary min-h-12 w-full sm:w-auto sm:self-start"
			>{t(data.locale, 'admin.timezone_save')}</button
		>
	</form>
</SubPage>
