<script lang="ts">
	import { t } from '$lib/i18n';
	let { data } = $props();
</script>

<div class="alert alert-error" role="alert">
	{t(data.locale, data.status === 'rate_limited' ? 'login.rate_limited' : 'login.invalid')}
</div>
