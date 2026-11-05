<script lang="ts">
	import { t } from '$lib/i18n';
	import FilmInfo from '$lib/components/FilmInfo.svelte';
	import Invitation from '$lib/components/Invitation.svelte';
	import ShareButton from '$lib/components/ShareButton.svelte';
	import { ChevronLeft } from '@lucide/svelte';
	let { data } = $props();
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
			href="/groups/{data.group.groupId}"
			data-sveltekit-preload-data="off"
		>
			<ChevronLeft class="size-4" />{t(data.locale, 'film.back')}
		</a>
		<ShareButton locale={data.locale} film={data.film} group={data.group.name} />
	</div>

	<FilmInfo
		locale={data.locale}
		film={data.film}
		details={data.details ?? null}
		tmdbUrl={data.tmdbUrl ?? null}
	/>
{/if}
