<script lang="ts">
	import '../app.css';
	import { t } from '$lib/i18n';
	import { CircleUser, ShieldCheck, Users } from '@lucide/svelte';
	import TvLogo from '$lib/components/TvLogo.svelte';
	import LocaleSelect from '$lib/components/LocaleSelect.svelte';
	import { onMount } from 'svelte';
	import { originMismatch } from '$lib/origin';

	let { data, children } = $props();

	// Only the browser knows the address in its bar (see $lib/origin).
	let browserOrigin = $state<string | null>(null);
	onMount(() => (browserOrigin = location.origin));
	const wrongOrigin = $derived(
		browserOrigin !== null && originMismatch(data.serverOrigin, browserOrigin)
	);

	const sections = $derived(
		[
			{ href: '/groups', label: t(data.locale, 'nav.groups'), icon: Users },
			{ href: '/profile', label: t(data.locale, 'nav.profile'), icon: CircleUser },
			...(data.user?.isAdmin
				? [{ href: '/admin', label: t(data.locale, 'nav.admin'), icon: ShieldCheck }]
				: [])
		].map((s) => ({
			...s,
			current: data.pathname === s.href || data.pathname.startsWith(`${s.href}/`)
		}))
	);
</script>

<div class="min-h-dvh bg-base-200">
	<header
		class="navbar sticky top-0 z-10 min-h-14 border-b border-base-300 bg-base-100/90 px-4 backdrop-blur"
	>
		<a class="flex min-h-12 items-center gap-2 text-lg font-bold" href="/">
			<!-- The one amber mark in the chrome: a fill with dark ink, never amber on white. -->
			<span class="grid size-8 place-items-center rounded-field bg-primary text-primary-content">
				<TvLogo class="size-6" />
			</span>
			{t(data.locale, 'app.name')}
		</a>
		<div class="flex-1"></div>
		{#if data.user}
			<nav class="hidden gap-1 md:flex" aria-label={t(data.locale, 'nav.main')}>
				{#each sections as s (s.href)}
					<a
						class={['btn btn-ghost min-h-12', s.current && 'btn-active']}
						href={s.href}
						aria-current={s.current ? 'page' : undefined}
					>
						<s.icon class="size-4" />{s.label}
					</a>
				{/each}
			</nav>
		{/if}
		<!-- Signed in: on phones the language select lives on /profile, so the bar
		     stays uncluttered. Signed out: there is no profile, so it stays here. -->
		<LocaleSelect
			locale={data.locale}
			pathname={data.pathname}
			class={['ml-2', data.user && 'hidden md:block'].filter(Boolean).join(' ')}
		/>
	</header>

	<main
		class={[
			'mx-auto max-w-3xl px-4 py-6',
			data.user && 'pb-[calc(5rem+env(safe-area-inset-bottom))] md:pb-6'
		]}
	>
		{#if wrongOrigin}
			<div class="alert alert-error mb-4" role="alert">
				{t(data.locale, 'origin.mismatch', {
					browser: browserOrigin ?? '',
					server: data.serverOrigin
				})}
			</div>
		{/if}
		{@render children()}
	</main>

	{#if data.user}
		<nav class="dock md:hidden" aria-label={t(data.locale, 'nav.main')}>
			{#each sections as s (s.href)}
				<a
					href={s.href}
					class={['min-h-12', s.current && 'dock-active font-bold']}
					aria-current={s.current ? 'page' : undefined}
				>
					<s.icon class="size-5" strokeWidth={s.current ? 2.25 : 1.75} />
					<span class="dock-label">{s.label}</span>
				</a>
			{/each}
		</nav>
	{/if}
</div>
