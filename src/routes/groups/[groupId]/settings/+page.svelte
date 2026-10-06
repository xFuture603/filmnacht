<script lang="ts">
	import { t } from '$lib/i18n';
	import PageHeader from '$lib/components/PageHeader.svelte';
	import GroupTabs from '$lib/components/GroupTabs.svelte';
	import Field from '$lib/components/Field.svelte';
	import Toast from '$lib/components/Toast.svelte';
	import { TriangleAlert, Users } from '@lucide/svelte';
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
	counts={data.newCounts}
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
	<!-- Solid fill, not alert-soft: amber-on-white/amber-on-dark tinted text
	     reads at ~2:1 contrast, below WCAG AA. A solid warning fill keeps
	     amber to what the brief allows it for (a fill), with dark ink on top. -->
	<div class="alert alert-warning mb-4" role="alert">
		<TriangleAlert class="size-5 shrink-0" />
		{t(data.locale, 'settings.auto_draw_silent')}
	</div>
{/if}

<section class="card border border-base-300 bg-base-100 shadow-sm">
	<div class="card-body">
		<h2 class="card-title text-lg">{t(data.locale, 'settings.title')}</h2>
		<form method="POST" action="?/save" class="flex flex-col gap-4">
			<div class="flex flex-col gap-1">
				<!-- Not wrapped in Field: Field's own label would sit around this one,
				     and a label nested inside another label is skipped by the accessible-
				     name computation — the toggle would announce as its hint text instead
				     of "Automatic draw". One label, the setting's name as its only text,
				     and the hint as a separate paragraph tied on with aria-describedby. -->
				<label class="flex min-h-11 cursor-pointer items-center gap-3">
					<input
						type="checkbox"
						name="autoDraw"
						class="toggle toggle-primary"
						checked={s.autoDraw}
						disabled={autoDrawDisabled}
						aria-describedby="auto-draw-hint"
					/>
					{t(data.locale, 'settings.auto_draw')}
				</label>
				<p id="auto-draw-hint" class="text-sm text-base-content/70">
					{#if !data.mailConfigured && !s.autoDraw}
						{t(data.locale, 'settings.auto_draw_needs_mail')}
						{#if data.user?.isAdmin}
							<a class="link" href="/admin">{t(data.locale, 'nav.admin')}</a>
						{/if}
					{:else if data.mailConfigured}
						{t(data.locale, 'settings.auto_draw_hint')}
					{/if}
					<!-- Mail off but autoDraw already on: the warning banner above says
					     everything that needs saying here, so this stays empty rather
					     than repeating it in a second voice. -->
				</p>
			</div>

			<Field label={t(data.locale, 'settings.draw_before')}>
				<select name="autoDrawHoursBefore" class="select min-h-11 w-full sm:w-64">
					{#each data.choices.autoDrawHoursBefore as n (n)}
						<option value={n} selected={n === s.autoDrawHoursBefore}
							>{t(data.locale, 'settings.hours_before', { n })}</option
						>
					{/each}
				</select>
			</Field>

			<div class="flex flex-col gap-1">
				<label class="flex min-h-11 cursor-pointer items-center gap-3">
					<input
						type="checkbox"
						name="surprise"
						class="toggle"
						checked={s.resultVisible === 'on_night'}
						aria-describedby="surprise-hint"
					/>
					{t(data.locale, 'settings.surprise')}
				</label>
				<p id="surprise-hint" class="text-sm text-base-content/70">
					{t(data.locale, 'settings.surprise_hint')}
				</p>
			</div>

			<div class="flex flex-col gap-1">
				<label class="flex min-h-11 cursor-pointer items-center gap-3">
					<input
						type="checkbox"
						name="fairDraw"
						class="toggle"
						checked={s.drawMode === 'fairness'}
						aria-describedby="fair-draw-hint"
					/>
					{t(data.locale, 'settings.fair')}
				</label>
				<p id="fair-draw-hint" class="text-sm text-base-content/70">
					{t(data.locale, 'settings.fair_hint')}
				</p>
			</div>

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

<section class="card mt-6 border border-error/40 bg-base-100 shadow-sm">
	<div class="card-body">
		<h2 class="card-title text-lg text-error">
			<TriangleAlert class="size-5" />{t(data.locale, 'settings.delete_title')}
		</h2>
		<p class="text-sm text-base-content/70">{t(data.locale, 'settings.delete_hint')}</p>
		<form method="POST" action="?/deleteGroup" class="flex flex-col gap-2">
			<Field label={t(data.locale, 'settings.delete_label', { group: data.group.name })}>
				<input name="name" required autocomplete="off" class="input min-h-11 w-full" />
			</Field>
			<button class="btn btn-error min-h-11 w-full sm:w-auto sm:self-start"
				>{t(data.locale, 'settings.delete')}</button
			>
		</form>
	</div>
</section>
