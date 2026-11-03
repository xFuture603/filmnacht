<script lang="ts">
	import type { Snippet } from 'svelte';
	import { ChevronLeft } from '@lucide/svelte';
	import { t, type Locale } from '$lib/i18n';
	import PageHeader from '$lib/components/PageHeader.svelte';
	import RequiredNote from '$lib/components/RequiredNote.svelte';
	import Toast from '$lib/components/Toast.svelte';

	/**
	 * One page behind a row of a grouped list (the profile, the admin page),
	 * like a pane in iOS Settings: a way back, a large title, then the form.
	 */
	let {
		locale,
		back,
		title,
		subtitle,
		form,
		success = form?.success,
		required = true,
		intro,
		children
	}: {
		locale: Locale;
		back: { href: string; label: string };
		title: string;
		subtitle?: string;
		form: { error?: string; success?: string } | null | undefined;
		/** The i18n key of the toast after a save; the profile's actions name it `success`. */
		success?: string;
		/** False when the page has no required field to explain the asterisk for. */
		required?: boolean;
		/** What the page does, read before the note about required fields. */
		intro?: Snippet;
		children: Snippet;
	} = $props();
</script>

<a class="btn btn-outline mb-2 min-h-12 gap-1" href={back.href}>
	<ChevronLeft class="size-4" />{back.label}
</a>

<PageHeader {title} {subtitle} />

{#if form?.error}
	<div class="alert alert-error alert-soft mb-4" role="alert">{t(locale, form.error)}</div>
{/if}

{@render intro?.()}
{#if required}<div class="mb-4"><RequiredNote {locale} /></div>{/if}
{#key form}
	{#if success}<Toast message={t(locale, success)} {locale} />{/if}
{/key}

{@render children()}
