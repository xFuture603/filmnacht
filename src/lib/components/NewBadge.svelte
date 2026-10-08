<script lang="ts">
	/**
	 * "New" everywhere it appears: a dark badge with a dot, so it reads as new at
	 * a glance next to other dark badges ("Film drawn") without relying on colour.
	 */
	let { label, class: className = '' }: { label: string; class?: string } = $props();
</script>

<span class={['badge gap-1 badge-sm badge-neutral', className]}>
	<span class="size-1.5 rounded-full bg-current" aria-hidden="true"></span>{label}
</span>
