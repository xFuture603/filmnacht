<script lang="ts">
	import '../app.css';
	import { t } from '$lib/i18n';
	import Icon, { type IconName } from '$lib/components/Icon.svelte';
	import LocaleSelect from '$lib/components/LocaleSelect.svelte';

	let { data, children } = $props();

	const sections = $derived(
		[
			{ href: '/groups', label: t(data.locale, 'nav.groups'), icon: 'groups' as IconName },
			{ href: '/profile', label: t(data.locale, 'nav.profile'), icon: 'profile' as IconName },
			...(data.user?.isAdmin
				? [{ href: '/admin', label: t(data.locale, 'nav.admin'), icon: 'admin' as IconName }]
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
		<a class="flex min-h-11 items-center gap-2 text-lg font-semibold" href="/">
			<span aria-hidden="true">🎬</span>{t(data.locale, 'app.name')}
		</a>
		<div class="flex-1"></div>
		{#if data.user}
			<nav class="hidden gap-1 md:flex" aria-label={t(data.locale, 'nav.main')}>
				{#each sections as s (s.href)}
					<a
						class={['btn btn-ghost min-h-11', s.current && 'btn-active']}
						href={s.href}
						aria-current={s.current ? 'page' : undefined}>{s.label}</a
					>
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
		{@render children()}
	</main>

	{#if data.user}
		<nav class="dock md:hidden" aria-label={t(data.locale, 'nav.main')}>
			{#each sections as s (s.href)}
				<a
					href={s.href}
					class={['min-h-11', s.current && 'dock-active font-semibold']}
					aria-current={s.current ? 'page' : undefined}
				>
					<Icon name={s.icon} class="size-6" />
					<span class="dock-label">{s.label}</span>
				</a>
			{/each}
		</nav>
	{/if}
</div>
