<script lang="ts">
	import { t } from '$lib/i18n';
	import PageHeader from '$lib/components/PageHeader.svelte';
	import GroupTabs from '$lib/components/GroupTabs.svelte';
	import EmptyState from '$lib/components/EmptyState.svelte';
	import NightStatus from '$lib/components/NightStatus.svelte';
	import Scheduler from './Scheduler.svelte';
	import { CalendarDays, MapPin, Star, Users } from '@lucide/svelte';
	let { data, form } = $props();

	const fmt = (n: number) =>
		new Intl.NumberFormat(data.locale === 'de' ? 'de-DE' : 'en-GB', {
			minimumFractionDigits: 1,
			maximumFractionDigits: 1
		}).format(n);
</script>

<PageHeader title={data.group.name} icon={Users} />
<GroupTabs
	groupId={data.group.groupId}
	groupName={data.group.name}
	active="nights"
	locale={data.locale}
	isOwner={data.isOwner}
	counts={data.newCounts}
/>

{#snippet list(nights: typeof data.upcoming)}
	<ul class="grid gap-3">
		{#each nights as night (night.id)}
			<li>
				<a
					href="/groups/{data.group.groupId}/nights/{night.id}"
					class="card flex min-h-11 w-full flex-col gap-1 border border-base-300 bg-base-100 p-4 shadow-sm transition hover:shadow-md"
				>
					<div class="flex flex-wrap items-center justify-between gap-2">
						<span class="font-semibold">{night.when}</span>
						<span class="flex items-center gap-2">
							{#if night.average !== null}
								<span class="badge badge-sm badge-outline gap-1 tabular-nums">
									<Star class="size-3" />
									<span class="sr-only">{t(data.locale, 'ratings.average')}</span>
									{t(data.locale, 'ratings.average_short', { average: fmt(night.average) })}
								</span>
							{/if}
							{#if night.isNew}
								<span class="badge badge-sm badge-primary">{t(data.locale, 'new.badge')}</span>
							{/if}
							<NightStatus status={night.status} locale={data.locale} />
						</span>
					</div>
					{#if night.location}
						<span class="flex items-center gap-1 text-sm text-base-content/70">
							<MapPin class="size-4 shrink-0" /><span class="min-w-0 break-words"
								>{night.location}</span
							>
						</span>
					{/if}
					<span class="text-sm text-base-content/70">
						{t(data.locale, 'nights.counts', {
							yes: night.yes,
							maybe: night.maybe,
							no: night.no
						})}
					</span>
				</a>
			</li>
		{/each}
	</ul>
{/snippet}

{#if data.isOwner}
	<section class="card mb-6 border border-base-300 bg-base-100 shadow-sm">
		<div class="card-body">
			<h2 class="card-title text-lg">{t(data.locale, 'nights.schedule')}</h2>
			{#if form?.error}
				<div class="alert alert-error alert-soft" role="alert">{t(data.locale, form.error)}</div>
			{/if}
			<form method="POST" action="?/schedule" class="flex flex-col gap-4">
				<Scheduler
					locale={data.locale}
					timezone={data.timezone}
					today={data.today}
					initialMonth={data.month}
					defaults={data.defaults}
					usualTime={data.usualTime}
					locationMax={data.locationMax}
					echo={form ?? undefined}
				/>

				<button class="btn btn-primary min-h-11 w-full sm:w-auto sm:self-start"
					>{t(data.locale, 'nights.schedule')}</button
				>
			</form>
		</div>
	</section>
{/if}

{#if data.upcoming.length === 0 && data.past.length === 0}
	<EmptyState icon={CalendarDays} text={t(data.locale, 'nights.none')} />
{/if}

{#if data.upcoming.length > 0}
	<section class="mb-6">
		<h2 class="mb-3 text-lg font-semibold">{t(data.locale, 'nights.upcoming')}</h2>
		{@render list(data.upcoming)}
	</section>
{/if}

{#if data.past.length > 0}
	<section>
		<h2 class="mb-3 text-lg font-semibold">{t(data.locale, 'nights.past')}</h2>
		{@render list(data.past)}
	</section>
{/if}
