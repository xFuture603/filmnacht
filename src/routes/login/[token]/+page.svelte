<script lang="ts">
	import { t } from '$lib/i18n';
	let { data } = $props();
</script>

<div class="mx-auto w-full max-w-md">
	<div class="alert alert-error alert-soft" role="alert">
		{t(data.locale, data.status === 'rate_limited' ? 'login.rate_limited' : 'login.invalid')}
	</div>
</div>
