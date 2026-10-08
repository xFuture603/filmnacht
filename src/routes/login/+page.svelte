<script lang="ts">
	import RequiredNote from '$lib/components/RequiredNote.svelte';
	import { t } from '$lib/i18n';
	import FormCard from '$lib/components/FormCard.svelte';
	import Field from '$lib/components/Field.svelte';
	let { data, form } = $props();
</script>

<FormCard title={t(data.locale, 'login.title')}>
	{#if form?.error}
		<div class="alert alert-error alert-soft" role="alert">{t(data.locale, form.error)}</div>
	{/if}

	<form method="POST" class="flex flex-col gap-2">
		<RequiredNote locale={data.locale} />
		<!-- Without this the action's form.get('redirectTo') is always null and
		     every sign-in lands on /groups, silently dropping the deep link. -->
		<input type="hidden" name="redirectTo" value={data.redirectTo} />

		<Field label={t(data.locale, 'auth.username')}>
			<input name="username" required autocomplete="username" class="input min-h-12 w-full" />
		</Field>

		<Field label={t(data.locale, 'auth.password')}>
			<!-- No minlength: the login form is not the place to publish the password
			     rules, and a client-side bound that disagrees with the server would
			     only ever lock someone out of their own account. -->
			<input
				name="password"
				type="password"
				required
				autocomplete="current-password"
				class="input min-h-12 w-full"
			/>
		</Field>

		<button class="btn btn-primary mt-2 min-h-12 w-full">{t(data.locale, 'login.submit')}</button>
	</form>

	<p class="text-sm text-base-content/70">
		{t(data.locale, 'login.forgot')}
		<a class="link" href="/reset">{t(data.locale, 'reset.title')}</a>
	</p>
</FormCard>
