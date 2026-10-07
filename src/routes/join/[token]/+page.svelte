<script lang="ts">
	import { t } from '$lib/i18n';
	import FormCard from '$lib/components/FormCard.svelte';
	import Field from '$lib/components/Field.svelte';
	let { data, form } = $props();
</script>

{#if data.rateLimited}
	<div class="mx-auto w-full max-w-md">
		<div class="alert alert-warning alert-soft" role="alert">
			{t(data.locale, 'invite.rate_limited')}
		</div>
	</div>
{:else if !data.invite}
	<div class="mx-auto w-full max-w-md">
		<div class="alert alert-error alert-soft" role="alert">{t(data.locale, 'invite.invalid')}</div>
	</div>
{:else}
	<FormCard title={t(data.locale, 'invite.join_title', { group: data.invite.groupName })}>
		{#if form?.error}
			<div class="alert alert-error alert-soft" role="alert">{t(data.locale, form.error)}</div>
		{/if}

		{#if data.user}
			<p>{t(data.locale, 'invite.join_as', { name: data.user.displayName })}</p>
			<form method="POST">
				<button class="btn btn-primary min-h-11 w-full"
					>{t(data.locale, 'invite.join_submit')}</button
				>
			</form>
		{:else}
			<form method="POST" class="flex flex-col gap-2">
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

				<button class="btn btn-primary mt-2 min-h-11 w-full"
					>{t(data.locale, 'invite.join_submit')}</button
				>
			</form>

			<p class="text-sm">
				<a class="link" href="/login?redirectTo=/join/{data.token}">
					{t(data.locale, 'invite.have_account')}
				</a>
			</p>
		{/if}
	</FormCard>
{/if}
