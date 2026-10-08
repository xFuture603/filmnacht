<script lang="ts">
	import { t, type Locale } from '$lib/i18n';
	let {
		status,
		locale
	}: { status: 'scheduled' | 'drawn' | 'watched' | 'cancelled'; locale: Locale } = $props();

	// Amber is for things you can press (Practical UI): status is neutral or a
	// system colour, and always text, never colour alone.
	const tone = {
		scheduled: 'badge-outline',
		drawn: 'badge-neutral',
		watched: 'badge-success',
		cancelled: 'badge-ghost'
	} as const;
</script>

<span class="badge badge-sm {tone[status]}">{t(locale, `nights.status.${status}`)}</span>
