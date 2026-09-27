<script lang="ts">
	import { t } from '$lib/i18n';
	import PageHeader from '$lib/components/PageHeader.svelte';
	import Field from '$lib/components/Field.svelte';
	import { CircleCheck, CircleX, Globe, Mail, Search, Send } from '@lucide/svelte';
	let { data, form } = $props();

	const card = 'card mb-4 border border-base-300 bg-base-100 shadow-sm';
</script>

<PageHeader title={t(data.locale, 'admin.title')} />

{#if form?.error}
	<div class="alert alert-error alert-soft mb-4" role="alert">{t(data.locale, form.error)}</div>
{/if}

{#if form?.recoveryUrl}
	<div class="alert alert-success alert-soft mb-2" role="alert">
		{t(data.locale, 'admin.recovered', { name: form.recoveredName })}
	</div>
	<!-- Readonly input rather than a <code> block, matching the login link on
	     /profile: it is the one thing on this page that has to be selected and
	     copied, often on a phone. -->
	<input class="input mb-6 min-h-11 w-full font-mono text-sm" readonly value={form.recoveryUrl} />
{/if}

<section class={card}>
	<div class="card-body">
		<h2 class="card-title text-lg"><Globe class="size-5" />{t(data.locale, 'admin.settings')}</h2>
		{#if form?.timezoneSaved}
			<div class="alert alert-success alert-soft" role="alert">
				{t(data.locale, 'admin.timezone_saved')}
			</div>
		{/if}
		<form method="POST" action="?/timezone" class="flex flex-col gap-2">
			<Field label={t(data.locale, 'admin.timezone')} hint={t(data.locale, 'admin.timezone_hint')}>
				<select name="timezone" required class="select min-h-11 w-full sm:w-80">
					{#each data.timezones as tz (tz)}
						<option value={tz} selected={tz === data.timezone}>{tz}</option>
					{/each}
				</select>
			</Field>
			<button class="btn btn-primary mt-2 min-h-11 w-full sm:w-auto sm:self-start"
				>{t(data.locale, 'admin.timezone_save')}</button
			>
		</form>
	</div>
</section>

<section class={card}>
	<div class="card-body">
		<h2 class="card-title text-lg"><Mail class="size-5" />{t(data.locale, 'admin.services')}</h2>
		<p class="text-sm text-base-content/70">{t(data.locale, 'admin.services_hint')}</p>

		<ul class="divide-y divide-base-300">
			<li class="flex items-start gap-3 py-3">
				{#if data.mail.configured}
					<CircleCheck class="mt-0.5 size-5 shrink-0 text-success" />
				{:else}
					<CircleX class="mt-0.5 size-5 shrink-0 text-base-content/50" />
				{/if}
				<div class="min-w-0">
					<p class="font-medium">{t(data.locale, 'admin.mail')}</p>
					<p class="text-sm break-words text-base-content/70">
						{data.mail.configured
							? t(data.locale, 'admin.mail_on', {
									from: data.mail.from ?? '',
									host: data.mail.host ?? '',
									port: data.mail.port
								})
							: t(data.locale, 'admin.mail_off')}
					</p>
				</div>
			</li>
			<li class="flex items-start gap-3 py-3">
				{#if data.tmdb}
					<CircleCheck class="mt-0.5 size-5 shrink-0 text-success" />
				{:else}
					<CircleX class="mt-0.5 size-5 shrink-0 text-base-content/50" />
				{/if}
				<div class="min-w-0">
					<p class="flex items-center gap-1 font-medium">
						<Search class="size-4" />{t(data.locale, 'admin.tmdb')}
					</p>
					<p class="text-sm text-base-content/70">
						{t(data.locale, data.tmdb ? 'admin.tmdb_on' : 'admin.tmdb_off')}
					</p>
				</div>
			</li>
		</ul>

		{#if form?.mailSent}
			<div class="alert alert-success alert-soft" role="alert">
				{t(data.locale, 'admin.mail_sent', { email: form.mailSent })}
			</div>
		{/if}
		{#if form?.mailCode}
			<div class="alert alert-error alert-soft flex-col items-start gap-1" role="alert">
				<p class="font-medium">{t(data.locale, 'admin.mail_failed', { code: form.mailCode })}</p>
				<p class="text-sm">{t(data.locale, `admin.mail_hint.${form.mailHint}`)}</p>
			</div>
		{/if}

		{#if data.myEmail}
			<form method="POST" action="?/testMail" class="flex flex-col gap-1">
				<button
					class="btn btn-outline min-h-11 w-full sm:w-auto sm:self-start"
					disabled={!data.mail.configured}
				>
					<Send class="size-4" />{t(data.locale, 'admin.test_mail')}
				</button>
				<p class="text-sm text-base-content/70">
					{t(data.locale, 'admin.test_mail_to', { email: data.myEmail })}
				</p>
			</form>
		{:else}
			<p class="text-sm text-base-content/70">
				<a class="link" href="/profile">{t(data.locale, 'admin.test_mail_no_email')}</a>
			</p>
		{/if}
	</div>
</section>

<section class="card border border-base-300 bg-base-100 shadow-sm">
	<div class="card-body">
		<h2 class="card-title text-lg">{t(data.locale, 'admin.members')}</h2>
		<p class="text-sm text-base-content/70">{t(data.locale, 'admin.recover_hint')}</p>

		<!-- One form around the whole list. Each row's submit button carries the
		     account it acts on as name/value, which is plain HTML and needs no
		     JavaScript and no password field per row. -->
		<form method="POST" action="?/recover" class="flex flex-col gap-3">
			<Field label={t(data.locale, 'admin.recover_password')}>
				<!-- No minlength: an account may predate a bound change, and a client-side
				     rule that disagrees with the server only ever locks someone out. -->
				<input
					name="currentPassword"
					type="password"
					required
					autocomplete="current-password"
					class="input min-h-11 w-full"
				/>
			</Field>

			<ul class="divide-y divide-base-300">
				{#each data.members as member (member.id)}
					<li class="flex flex-wrap items-center justify-between gap-2 py-3">
						<div class="min-w-0">
							<div class="break-words">{member.displayName}</div>
							<div class="font-mono text-xs text-base-content/70">{member.username}</div>
						</div>
						<button
							class="btn btn-outline btn-sm min-h-11"
							name="userId"
							value={member.id}
							aria-label={`${t(data.locale, 'admin.recover')} — ${member.username}`}
						>
							{t(data.locale, 'admin.recover')}
						</button>
					</li>
				{/each}
			</ul>
		</form>
	</div>
</section>
