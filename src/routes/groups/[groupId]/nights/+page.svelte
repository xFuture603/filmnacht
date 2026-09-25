<script lang="ts">
	import { t } from '$lib/i18n';
	import PageHeader from '$lib/components/PageHeader.svelte';
	import GroupTabs from '$lib/components/GroupTabs.svelte';
	import EmptyState from '$lib/components/EmptyState.svelte';
	import Field from '$lib/components/Field.svelte';
	import NightStatus from '$lib/components/NightStatus.svelte';
	let { data, form } = $props();

	const fmt = (n: number) =>
		new Intl.NumberFormat(data.locale === 'de' ? 'de-DE' : 'en-GB', {
			minimumFractionDigits: 1,
			maximumFractionDigits: 1
		}).format(n);
</script>

<PageHeader title={data.group.name} emoji={data.group.emoji ?? '🎬'} />
<GroupTabs
	groupId={data.group.groupId}
	groupName={data.group.name}
	active="nights"
	locale={data.locale}
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
								<span class="badge badge-sm badge-outline tabular-nums">
									{t(data.locale, 'ratings.average_short', { average: fmt(night.average) })}
								</span>
							{/if}
							<NightStatus status={night.status} locale={data.locale} />
						</span>
					</div>
					{#if night.location}
						<span class="text-sm break-words text-base-content/70">📍 {night.location}</span>
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
				<!-- Radio inputs styled as daisyUI buttons: one tap each, the checked one
				     turns amber, and it all posts without JavaScript. The label text is
				     the aria-label, which daisyUI also renders as the button's content. -->
				<fieldset class="flex flex-col gap-2">
					<legend class="mb-2 text-sm font-semibold">{t(data.locale, 'nights.day')}</legend>
					<div class="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-7">
						{#each data.days as day (day.value)}
							<input
								type="radio"
								name="day"
								value={day.value}
								aria-label={day.label}
								checked={(form?.day ?? data.defaults.day) === day.value}
								class="btn min-h-11 px-2"
							/>
						{/each}
					</div>
				</fieldset>

				<fieldset class="flex flex-col gap-2">
					<legend class="mb-2 text-sm font-semibold">{t(data.locale, 'nights.time')}</legend>
					<div class="grid grid-cols-4 gap-2 sm:grid-cols-8">
						{#each data.times as time (time)}
							<input
								type="radio"
								name="time"
								value={time}
								aria-label={time}
								checked={(form?.time ?? data.defaults.time) === time}
								class="btn min-h-11 px-2 tabular-nums"
							/>
						{/each}
					</div>
					<p class="text-xs text-base-content/70">
						{t(data.locale, 'nights.when_hint', { zone: data.timezone })}
					</p>
				</fieldset>

				<details
					class="rounded-box border border-base-300"
					open={!!(form?.otherDay || form?.otherTime)}
				>
					<summary class="flex min-h-11 cursor-pointer items-center px-4 text-sm font-semibold">
						{t(data.locale, 'nights.other')}
					</summary>
					<div class="grid grid-cols-1 gap-2 px-4 pb-4 sm:grid-cols-2">
						<Field label={t(data.locale, 'nights.other_day')}>
							<input
								type="date"
								name="other_day"
								value={form?.otherDay ?? ''}
								class="input min-h-11 w-full"
							/>
						</Field>
						<Field label={t(data.locale, 'nights.other_time')}>
							<input
								type="time"
								name="other_time"
								value={form?.otherTime ?? ''}
								class="input min-h-11 w-full"
							/>
						</Field>
					</div>
				</details>

				<Field label={t(data.locale, 'nights.where')}>
					<input
						name="location"
						maxlength={data.locationMax}
						value={form?.location ?? data.defaults.location}
						class="input min-h-11 w-full"
					/>
				</Field>

				<button class="btn btn-primary min-h-11 w-full sm:w-auto sm:self-start"
					>{t(data.locale, 'nights.schedule')}</button
				>
			</form>
		</div>
	</section>
{/if}

{#if data.upcoming.length === 0 && data.past.length === 0}
	<EmptyState icon="calendar" text={t(data.locale, 'nights.none')} />
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
