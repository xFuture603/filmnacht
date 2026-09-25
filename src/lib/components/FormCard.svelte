<script lang="ts">
	import type { Snippet } from 'svelte';
	let { title, intro, children }: { title: string; intro?: string; children: Snippet } = $props();
</script>

<div class="mx-auto w-full max-w-md">
	<div class="card border border-base-300 bg-base-100 shadow-sm">
		<div class="card-body gap-4">
			<h1 class="text-2xl font-bold tracking-tight">{title}</h1>
			{#if intro}<p class="text-base-content/70">{intro}</p>{/if}
			{@render children()}
		</div>
	</div>
</div>
