<script lang="ts">
	import { t } from '$lib/i18n';
	let { data, form } = $props();
</script>

<h1 class="mb-4 text-2xl font-bold">{t(data.locale, 'login.title')}</h1>

{#if form?.error}
	<div class="alert alert-error mb-4" role="alert">{t(data.locale, form.error)}</div>
{/if}

<form method="POST" class="flex flex-col gap-3">
	<!-- Without this the action's form.get('redirectTo') is always null and
	     every sign-in lands on /groups, silently dropping the deep link. -->
	<input type="hidden" name="redirectTo" value={data.redirectTo} />

	<label class="form-control">
		<span class="label-text">{t(data.locale, 'auth.username')}</span>
		<input name="username" required autocomplete="username" class="input input-bordered min-h-11" />
	</label>

	<label class="form-control">
		<span class="label-text">{t(data.locale, 'auth.password')}</span>
		<!-- No minlength: the login form is not the place to publish the password
		     rules, and a client-side bound that disagrees with the server would
		     only ever lock someone out of their own account. -->
		<input
			name="password"
			type="password"
			required
			autocomplete="current-password"
			class="input input-bordered min-h-11"
		/>
	</label>

	<button class="btn btn-primary min-h-11">{t(data.locale, 'login.submit')}</button>
</form>

<p class="mt-4 text-sm">
	{t(data.locale, 'login.forgot')}
	<a class="link" href="/reset">{t(data.locale, 'reset.title')}</a>
</p>
