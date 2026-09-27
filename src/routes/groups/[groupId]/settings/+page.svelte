<script lang="ts">
	import { t } from '$lib/i18n';
	import PageHeader from '$lib/components/PageHeader.svelte';
	import GroupTabs from '$lib/components/GroupTabs.svelte';
	import Field from '$lib/components/Field.svelte';
	import Toast from '$lib/components/Toast.svelte';
	import { Users } from '@lucide/svelte';
	let { data, form } = $props();

	const s = $derived(data.settings);
	// A checkbox disabled while off keeps a group that never configured mail
	// from silently flipping this on through a stale, disabled-looking control;
	// one already on stays editable so the owner can turn it back off.
	const autoDrawDisabled = $derived(!data.mailConfigured && !s.autoDraw);
</script>

<PageHeader title={data.group.name} icon={Users} />
<GroupTabs
	groupId={data.group.groupId}
	groupName={data.group.name}
	active="settings"
	locale={data.locale}
	isOwner={data.group.role === 'owner'}
/>

{#key form}
	{#if form?.saved}
		<Toast message={t(data.locale, 'settings.saved')} locale={data.locale} />
	{/if}
{/key}

{#if form?.error}
	<div class="alert alert-error alert-soft mb-4" role="alert">{t(data.locale, form.error)}</div>
{/if}

{#if s.autoDraw && !data.mailConfigured}
	<div class="alert alert-warning alert-soft mb-4" role="alert">
		{t(data.locale, 'settings.auto_draw_silent')}
	</div>
{/if}

<section class="card border border-base-300 bg-base-100 shadow-sm">
	<div class="card-body">
		<h2 class="card-title text-lg">{t(data.locale, 'settings.title')}</h2>
		<form method="POST" action="?/save" class="flex flex-col gap-4">
			<Field label={t(data.locale, 'settings.auto_draw')}>
				<label class="flex min-h-11 items-center gap-3">
					<input
						type="checkbox"
						name="autoDraw"
						class="toggle toggle-primary"
						checked={s.autoDraw}
						disabled={autoDrawDisabled}
					/>
					<span class="text-sm text-base-content/70">
						{#if !data.mailConfigured}
							{#if data.user?.isAdmin}
								{t(data.locale, 'settings.auto_draw_needs_mail')}
								<a class="link" href="/admin">{t(data.locale, 'nav.admin')}</a>
							{:else}
								{t(data.locale, 'settings.auto_draw_needs_mail')}
							{/if}
						{:else}
							{t(data.locale, 'settings.auto_draw_hint')}
						{/if}
					</span>
				</label>
			</Field>

			<Field label={t(data.locale, 'settings.draw_before')}>
				<select name="autoDrawHoursBefore" class="select min-h-11 w-full sm:w-64">
					{#each data.choices.autoDrawHoursBefore as n (n)}
						<option value={n} selected={n === s.autoDrawHoursBefore}
							>{t(data.locale, 'settings.hours_before', { n })}</option
						>
					{/each}
				</select>
			</Field>

			<Field label={t(data.locale, 'settings.surprise')}>
				<label class="flex min-h-11 items-center gap-3">
					<input
						type="checkbox"
						name="surprise"
						class="toggle"
						checked={s.resultVisible === 'on_night'}
					/>
					<span class="text-sm text-base-content/70"
						>{t(data.locale, 'settings.surprise_hint')}</span
					>
				</label>
			</Field>

			<Field label={t(data.locale, 'settings.fair')}>
				<label class="flex min-h-11 items-center gap-3">
					<input
						type="checkbox"
						name="fairDraw"
						class="toggle"
						checked={s.drawMode === 'fairness'}
					/>
					<span class="text-sm text-base-content/70">{t(data.locale, 'settings.fair_hint')}</span>
				</label>
			</Field>

			<Field label={t(data.locale, 'settings.films_per_member')}>
				<select name="maxOpenSuggestions" class="select min-h-11 w-full sm:w-64">
					{#each data.choices.maxOpenSuggestions as n (n)}
						<option value={n} selected={n === s.maxOpenSuggestions}>{n}</option>
					{/each}
				</select>
			</Field>

			<Field label={t(data.locale, 'settings.night_ends')}>
				<select name="nightEndsAfterMinutes" class="select min-h-11 w-full sm:w-64">
					{#each data.choices.nightEndsAfterMinutes as n (n)}
						<option value={n} selected={n === s.nightEndsAfterMinutes}
							>{t(data.locale, 'settings.hours_after', { n: n / 60 })}</option
						>
					{/each}
				</select>
			</Field>

			<Field label={t(data.locale, 'settings.rating_window')}>
				<select name="ratingWindowDays" class="select min-h-11 w-full sm:w-64">
					{#each data.choices.ratingWindowDays as n (n)}
						<option value={n} selected={n === s.ratingWindowDays}
							>{t(data.locale, 'settings.days', { n })}</option
						>
					{/each}
				</select>
			</Field>

			<button class="btn btn-primary min-h-11 w-full sm:w-auto sm:self-start"
				>{t(data.locale, 'settings.save')}</button
			>
		</form>
	</div>
</section>
