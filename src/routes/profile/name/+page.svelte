<script lang="ts">
	import { t } from '$lib/i18n';
	import Field from '$lib/components/Field.svelte';
	import SubPage from '$lib/components/SubPage.svelte';
	let { data, form } = $props();
</script>

<SubPage
	locale={data.locale}
	back={{ href: '/profile', label: t(data.locale, 'profile.title') }}
	title={t(data.locale, 'profile.display_name_heading')}
	{form}
>
	<form method="POST" action="?/changeDisplayName" class="mb-6 flex flex-col gap-6">
		<Field
			label={t(data.locale, 'auth.display_name')}
			hint={t(data.locale, 'auth.display_name_hint')}
		>
			<input
				name="displayName"
				required
				maxlength="60"
				autocomplete="nickname"
				value={data.displayName}
				class="input min-h-12 w-full"
			/>
		</Field>
		<button class="btn btn-primary min-h-12 w-full sm:w-auto sm:self-start"
			>{t(data.locale, 'profile.save_display_name')}</button
		>
	</form>
</SubPage>
