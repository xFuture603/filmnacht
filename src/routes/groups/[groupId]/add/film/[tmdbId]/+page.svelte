<script lang="ts">
	import { afterNavigate } from '$app/navigation';
	import { t } from '$lib/i18n';
	import FilmInfo from '$lib/components/FilmInfo.svelte';
	import Invitation from '$lib/components/Invitation.svelte';
	import ShareButton from '$lib/components/ShareButton.svelte';
	import { ChevronLeft } from '@lucide/svelte';
	let { data } = $props();

	// Going back rather than to a fresh search page keeps the results and the
	// scroll position. A shared link has nothing to go back to.
	let fromSearch = false;
	afterNavigate(({ from }) => {
		if (from) fromSearch = from.route.id === '/groups/[groupId]/add';
	});
</script>

{#if !data.film}
	<Invitation
		locale={data.locale}
		loginPath={data.pathname}
		preview={data.preview}
		question={data.question}
	/>
{:else}
	<div class="mb-2 flex items-center justify-between gap-2">
		<a
			class="btn btn-outline min-h-12 gap-1"
			href="/groups/{data.group.groupId}/add"
			data-sveltekit-preload-data="off"
			onclick={(e) => {
				if (!fromSearch) return;
				e.preventDefault();
				history.back();
			}}
		>
			<ChevronLeft class="size-4" />{t(data.locale, 'add.back_search')}
		</a>
		<ShareButton locale={data.locale} film={data.film} group={data.group.name} />
	</div>

	<FilmInfo
		locale={data.locale}
		film={data.film}
		details={data.details ?? null}
		tmdbUrl={data.tmdbUrl ?? null}
	>
		{#if data.taken}
			<p class="mb-4 text-base-content/70">{t(data.locale, 'add.taken')}</p>
		{:else if data.capped}
			<div class="alert alert-info alert-soft mb-4" role="status">
				{t(data.locale, 'pool.error.cap_reached')}
			</div>
		{:else}
			<form method="POST" action="/groups/{data.group.groupId}/add?/adopt" class="mb-4">
				<button
					name="tmdbId"
					value={data.film.tmdbId}
					class="btn btn-primary min-h-12 w-full sm:w-auto"
				>
					{t(data.locale, 'add.adopt')}
				</button>
			</form>
		{/if}
	</FilmInfo>
{/if}
