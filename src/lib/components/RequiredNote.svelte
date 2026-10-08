<script lang="ts">
	import { t, type Locale } from '$lib/i18n';
	let { locale }: { locale: Locale } = $props();
</script>

<!-- Explains the asterisk app.css puts on every Field with a required control. -->
<p class="text-sm text-base-content/70">{t(locale, 'form.required_note')}</p>
