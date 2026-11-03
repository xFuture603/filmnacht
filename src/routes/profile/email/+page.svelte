<script lang="ts">
	import { t } from '$lib/i18n';
	import Field from '$lib/components/Field.svelte';
	import SubPage from '$lib/components/SubPage.svelte';
	let { data, form } = $props();
</script>

<SubPage
	locale={data.locale}
	back={{ href: '/profile', label: t(data.locale, 'profile.title') }}
	title={t(data.locale, 'profile.email')}
	{form}
	required={false}
>
	<form method="POST" action="?/setEmail" class="mb-6 flex flex-col gap-6">
		<Field
			label={t(data.locale, 'profile.email_label')}
			hint={t(data.locale, 'profile.email_hint')}
		>
			<!-- Not required: leaving it empty is how you clear it. -->
			<input
				name="email"
				type="email"
				maxlength="254"
				autocomplete="email"
				value={data.email ?? ''}
				class="input min-h-12 w-full"
			/>
		</Field>
		<button class="btn btn-primary min-h-12 w-full sm:w-auto sm:self-start"
			>{t(data.locale, 'profile.save_email')}</button
		>
	</form>
</SubPage>
