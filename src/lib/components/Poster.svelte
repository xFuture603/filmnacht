<script lang="ts">
	let { src, title }: { src: string | null; title: string } = $props();
</script>

<!-- alt="" on purpose: every poster sits next to its title in text, so a spoken
     alt would read the title twice. The no-poster tile shows the title because
     an empty grey box saying "no poster" tells nobody which film it is. -->
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
		class="flex aspect-[2/3] w-full items-end rounded-box bg-gradient-to-br from-base-300 to-base-200 p-3"
		aria-hidden="true"
	>
		<span class="line-clamp-4 text-sm font-semibold break-words">{title}</span>
	</div>
{/if}
