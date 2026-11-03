<script lang="ts">
	import { t } from '$lib/i18n';
	import PageHeader from '$lib/components/PageHeader.svelte';
	import Scheduler from '../Scheduler.svelte';
	import { ChevronLeft } from '@lucide/svelte';
	let { data, form } = $props();
</script>

<a
	class="btn btn-outline mb-2 min-h-12 gap-1"
	href="/groups/{data.group.groupId}/nights"
	data-sveltekit-preload-data="off"
>
	<ChevronLeft class="size-4" />{t(data.locale, 'night.back')}
</a>

<PageHeader title={t(data.locale, 'nights.schedule')} />

{#if form?.error}
	<div class="alert alert-error alert-soft mb-4" role="alert">{t(data.locale, form.error)}</div>
{/if}

<!-- The scheduler is its own grouped list: no card around it. -->
<form method="POST" action="?/schedule" class="mb-6 flex flex-col gap-6">
	<Scheduler
		locale={data.locale}
		today={data.today}
		defaults={data.defaults}
		locationMax={data.locationMax}
		echo={form ?? undefined}
	/>

	<button class="btn btn-primary min-h-12 w-full sm:w-auto sm:self-start"
		>{t(data.locale, 'nights.schedule')}</button
	>
</form>
