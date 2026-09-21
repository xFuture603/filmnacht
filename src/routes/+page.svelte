<script lang="ts">
	import { t } from '$lib/i18n';
	let { data } = $props();
</script>

<h1 class="text-2xl font-bold">{t(data.locale, 'app.name')}</h1>
<p>{t(data.locale, 'home.no_groups')}</p>
