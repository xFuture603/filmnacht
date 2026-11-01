<script lang="ts">
	import { Check, CircleQuestionMark, X } from '@lucide/svelte';
	import { t, type Locale } from '$lib/i18n';

	/**
	 * Yes, maybe or no to a night: one choice of three, so the segmented control
	 * the group tabs use. Goes inside the page's own form: each answer submits
	 * itself as `response`. The chosen one is raised and shows its own symbol
	 * (check, question mark, cross); the symbol is what tells it apart without
	 * relying on the faint raised segment.
	 */
	let { current, locale }: { current: 'yes' | 'maybe' | 'no' | null; locale: Locale } = $props();

	const answers = ['yes', 'maybe', 'no'] as const;
	const icons = { yes: Check, maybe: CircleQuestionMark, no: X };
</script>

<div class="tabs tabs-box w-full flex-nowrap bg-secondary p-1">
	{#each answers as answer (answer)}
		<button
			name="response"
			value={answer}
			aria-pressed={current === answer}
			class={[
				// Grows with its label: on a narrow phone a long one may wrap.
				'tab h-auto min-h-12 flex-1 gap-1 px-2 py-2 leading-tight whitespace-normal',
				current === answer && 'tab-active font-bold'
			]}
		>
			{#if current === answer}
				{@const Icon = icons[answer]}
				<Icon class="size-4 shrink-0" strokeWidth={2.5} />
			{/if}
			{t(locale, `next.answer.${answer}`)}
		</button>
	{/each}
</div>
