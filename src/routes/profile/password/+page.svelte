<script lang="ts">
	import { t } from '$lib/i18n';
	import Field from '$lib/components/Field.svelte';
	import SubPage from '$lib/components/SubPage.svelte';
	let { data, form } = $props();
</script>

<SubPage
	locale={data.locale}
	back={{ href: '/profile', label: t(data.locale, 'profile.title') }}
	title={t(data.locale, 'profile.change_password')}
	{form}
>
	<form method="POST" action="?/changePassword" class="mb-6 flex flex-col gap-4">
		<Field label={t(data.locale, 'profile.current_password')}>
			<!-- No minlength: an account may predate a bound change, and a client-side
			     rule that disagrees with the server only ever locks someone out. -->
			<input
				name="currentPassword"
				type="password"
				required
				autocomplete="current-password"
				class="input min-h-12 w-full"
			/>
		</Field>
		<Field
			label={t(data.locale, 'profile.new_password')}
			hint={t(data.locale, 'auth.password_hint')}
		>
			<input
				name="newPassword"
				type="password"
				required
				minlength="8"
				maxlength="200"
				autocomplete="new-password"
				class="input min-h-12 w-full"
			/>
		</Field>
		<Field label={t(data.locale, 'auth.password_repeat')}>
			<input
				name="passwordRepeat"
				type="password"
				required
				minlength="8"
				maxlength="200"
				autocomplete="new-password"
				class="input min-h-12 w-full"
			/>
		</Field>
		<button class="mt-2 btn btn-primary min-h-12 w-full sm:w-auto sm:self-start"
			>{t(data.locale, 'profile.change_password')}</button
		>
	</form>
</SubPage>
