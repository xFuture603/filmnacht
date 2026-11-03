<script lang="ts">
	import { t, type Locale } from '$lib/i18n';
	import PageHeader from '$lib/components/PageHeader.svelte';
	import Toast from '$lib/components/Toast.svelte';
	import { footer, group, header, link, row } from '$lib/grouped-list';
	import { ChevronRight, CircleCheck, CircleX, Send } from '@lucide/svelte';
	let { data, form } = $props();

	// Each language's own name for itself, not translated: a German speaker
	// looking for their language in an English-language admin page still reads
	// "Deutsch", the same way it appears in any other app's language picker.
	const languageNames: Record<Locale, string> = { en: 'English', de: 'Deutsch' };

	const services = $derived([
		{
			label: t(data.locale, 'admin.mail'),
			on: data.mail.configured,
			detail: data.mail.configured
				? t(data.locale, 'admin.mail_on', {
						from: data.mail.from ?? '',
						host: data.mail.host ?? '',
						port: data.mail.port
					})
				: t(data.locale, 'admin.mail_off')
		},
		{
			label: t(data.locale, 'admin.tmdb'),
			on: data.tmdb,
			detail: data.tmdb ? null : t(data.locale, 'admin.tmdb_off')
		}
	]);
</script>

<PageHeader title={t(data.locale, 'admin.title')} />

{#key form}
	{#if form?.mailSent}
		<Toast
			message={t(data.locale, 'admin.mail_sent', { email: form.mailSent })}
			locale={data.locale}
		/>
	{/if}
{/key}

{#if form?.error}
	<div class="alert alert-error alert-soft mb-4" role="alert">{t(data.locale, form.error)}</div>
{/if}

<section class="mb-8" aria-labelledby="admin-settings">
	<h2 id="admin-settings" class={header}>{t(data.locale, 'admin.settings')}</h2>
	<ul class={group}>
		<li>
			<a href="/admin/timezone" class={link}>
				<span class="shrink-0">{t(data.locale, 'admin.timezone')}</span>
				<span class="ms-auto min-w-0 truncate text-base-content/70">{data.timezone}</span>
				<ChevronRight class="size-4 shrink-0 text-base-content/50" strokeWidth={2.5} />
			</a>
		</li>
		<li>
			<a href="/admin/email-language" class={link}>
				<span class="shrink-0">{t(data.locale, 'admin.email_locale')}</span>
				<span class="ms-auto min-w-0 truncate text-base-content/70"
					>{languageNames[data.emailLocale]}</span
				>
				<ChevronRight class="size-4 shrink-0 text-base-content/50" strokeWidth={2.5} />
			</a>
		</li>
	</ul>
</section>

<section class="mb-8" aria-labelledby="admin-services">
	<h2 id="admin-services" class={header}>{t(data.locale, 'admin.services')}</h2>
	<ul class={group}>
		{#each services as service (service.label)}
			<!-- Status, not a setting: it comes from the environment, so no chevron. -->
			<li class="{row} items-start">
				<div class="min-w-0 flex-1">
					<p>{service.label}</p>
					{#if service.detail}
						<p class="text-sm break-words text-base-content/70">{service.detail}</p>
					{/if}
				</div>
				<span class="flex shrink-0 items-center gap-1 text-base-content/70">
					{#if service.on}
						<CircleCheck class="size-5 text-success" />{t(data.locale, 'admin.on')}
					{:else}
						<CircleX class="size-5" />{t(data.locale, 'admin.off')}
					{/if}
				</span>
			</li>
		{/each}
		<li>
			{#if data.myEmail}
				<form method="POST" action="?/testMail">
					<button class="{link} font-bold" aria-describedby="test-mail-to">
						<Send class="size-4 shrink-0" />{t(data.locale, 'admin.test_mail')}
					</button>
				</form>
			{:else}
				<a href="/profile/email" class={link}>
					<span class="min-w-0 flex-1">{t(data.locale, 'admin.test_mail_no_email')}</span>
					<ChevronRight class="size-4 shrink-0 text-base-content/50" strokeWidth={2.5} />
				</a>
			{/if}
		</li>
	</ul>
	{#if form?.mailCode}
		<div class="alert alert-error alert-soft my-2 flex-col items-start gap-1" role="alert">
			<p class="font-bold">{t(data.locale, 'admin.mail_failed', { code: form.mailCode })}</p>
			<p class="text-sm">{t(data.locale, `admin.mail_hint.${form.mailHint}`)}</p>
		</div>
	{/if}
	{#if data.myEmail}
		<p id="test-mail-to" class="{footer} mb-2">
			{t(data.locale, 'admin.test_mail_to', { email: data.myEmail })}
		</p>
	{/if}
	<p class={footer}>{t(data.locale, 'admin.services_hint')}</p>
</section>

<!-- Lists that grow with the instance get their own pages, so this one stays short. -->
<section class="mb-8" aria-labelledby="admin-people">
	<h2 id="admin-people" class={header}>{t(data.locale, 'admin.people')}</h2>
	<ul class={group}>
		{#each [{ href: '/admin/members', label: t(data.locale, 'admin.accounts'), count: data.members.length }, { href: '/admin/groups', label: t(data.locale, 'admin.groups'), count: data.groups.length }] as r (r.href)}
			<li>
				<a href={r.href} class={link}>
					<span class="min-w-0 flex-1">{r.label}</span>
					<span class="text-base-content/70 tabular-nums">{r.count}</span>
					<ChevronRight class="size-4 shrink-0 text-base-content/50" strokeWidth={2.5} />
				</a>
			</li>
		{/each}
	</ul>
</section>
