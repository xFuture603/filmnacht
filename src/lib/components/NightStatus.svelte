<script lang="ts">
	import { t, type Locale } from '$lib/i18n';
	let {
		status,
		locale
	}: { status: 'scheduled' | 'drawn' | 'watched' | 'cancelled'; locale: Locale } = $props();

	const tone = {
		scheduled: 'badge-neutral',
		drawn: 'badge-primary',
		watched: 'badge-success',
		cancelled: 'badge-ghost'
	} as const;
</script>

<span class="badge badge-sm {tone[status]}">{t(locale, `nights.status.${status}`)}</span>
