<script lang="ts">
	import { page } from '$app/state';
	import type { Locale } from '$lib/i18n';
	import ErrorMessage from '$lib/components/ErrorMessage.svelte';
	import Invitation from './Invitation.svelte';

	// Someone signed in but outside the group gets the same page whether or not
	// the group or film exists: a guessed link reveals nothing. A member whose
	// film has gone (see +page.server.ts) gets the plain not-found page, and so
	// does any other error.
	const outsider = $derived(page.status === 404 && page.error?.message !== 'gone');
</script>

{#if outsider}
	<Invitation locale={(page.data?.locale ?? 'en') as Locale} />
{:else}
	<ErrorMessage />
{/if}
