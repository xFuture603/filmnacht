<script lang="ts">
	import RequiredNote from '$lib/components/RequiredNote.svelte';
	import { t } from '$lib/i18n';
	import FormCard from '$lib/components/FormCard.svelte';
	import Field from '$lib/components/Field.svelte';
	let { data, form } = $props();
</script>

<FormCard title={t(data.locale, 'setup.title')} intro={t(data.locale, 'setup.intro')}>
	{#if form?.error}
		<div class="alert alert-error alert-soft" role="alert">{t(data.locale, form.error)}</div>
	{/if}

	<form method="POST" class="flex flex-col gap-2">
		<RequiredNote locale={data.locale} />
		<Field label={t(data.locale, 'auth.username')} hint={t(data.locale, 'auth.username_hint')}>
			<input
				name="username"
				required
				minlength="3"
				maxlength="32"
				autocomplete="username"
				class="input min-h-11 w-full"
			/>
		</Field>

		<Field
			label={t(data.locale, 'auth.display_name')}
			hint={t(data.locale, 'auth.display_name_hint')}
		>
			<input
				name="displayName"
				required
				maxlength="60"
				autocomplete="nickname"
				class="input min-h-11 w-full"
			/>
		</Field>

		<Field
			label={t(data.locale, 'auth.email_optional')}
			hint={t(data.locale, 'profile.email_hint')}
		>
			<input
				name="email"
				type="email"
				maxlength="254"
				autocomplete="email"
				class="input min-h-11 w-full"
			/>
		</Field>

		<Field label={t(data.locale, 'auth.password')} hint={t(data.locale, 'auth.password_hint')}>
			<input
				name="password"
				type="password"
				required
				minlength="8"
				maxlength="200"
				autocomplete="new-password"
				class="input min-h-11 w-full"
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
				class="input min-h-11 w-full"
			/>
		</Field>

		<Field label={t(data.locale, 'setup.timezone')}>
			<select name="timezone" required class="select min-h-11 w-full">
				{#each data.timezones as tz (tz)}
					<option value={tz} selected={tz === 'Europe/Berlin'}>{tz}</option>
				{/each}
			</select>
		</Field>

		<button class="btn btn-primary mt-2 min-h-11 w-full">{t(data.locale, 'setup.submit')}</button>
	</form>
</FormCard>
