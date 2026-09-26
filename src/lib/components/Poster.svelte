<script lang="ts">
	import { Film } from '@lucide/svelte';
	let { src }: { src: string | null } = $props();
</script>

<!-- alt="" on purpose: every poster sits next to its title in text, so a spoken
     alt would read the title twice. For the same reason the no-poster tile shows
     a quiet film icon rather than the title: the title is right underneath it. -->
{#if src}
	<img
		class="aspect-[2/3] w-full rounded-box bg-base-300 object-cover"
		{src}
		alt=""
		loading="lazy"
		referrerpolicy="no-referrer"
	/>
{:else}
	<div
		class="flex aspect-[2/3] w-full items-center justify-center rounded-box bg-gradient-to-br from-base-300 to-base-200"
		aria-hidden="true"
	>
		<Film class="size-10 text-base-content/25" strokeWidth={1.5} />
	</div>
{/if}
