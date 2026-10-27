import { render } from 'svelte/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('$app/forms', () => ({ enhance: () => ({}) }));
vi.mock('$app/navigation', () => ({ invalidateAll: () => Promise.resolve() }));

const { default: Page } = await import('./+page.svelte');

const entry = (over: Record<string, unknown>) => ({
	suggestionId: 's1',
	title: 'Dune',
	year: 2021,
	posterUrl: null,
	runtime: 155,
	mine: false,
	status: 'open',
	night: null,
	isNew: false,
	drawnFor: null,
	...over
});

function body(pool: unknown[]) {
	return render(Page, {
		props: {
			data: {
				locale: 'en',
				group: { groupId: 'g1', name: 'Filmnacht', role: 'member' },
				members: [],
				pool,
				newCounts: {},
				toRate: [],
				next: null,
				used: 0,
				max: 3
			} as never,
			form: null
		}
	}).body;
}

describe('the pool', () => {
	it("links each film's title to its page", () => {
		expect(body([entry({})])).toMatch(/<a[^>]*href="\/groups\/g1\/films\/s1"[^>]*>\s*Dune\s*<\/a>/);
	});

	it('keeps the withdraw button outside the link and above it', () => {
		const html = body([entry({ mine: true })]);
		const link = html.match(/<a[^>]*href="\/groups\/g1\/films\/s1"[^>]*>[\s\S]*?<\/a>/)?.[0] ?? '';
		expect(link).not.toContain('<button');
		expect(html).toMatch(/<form[^>]*action="\?\/withdraw"[^>]*class="[^"]*z-10/);
	});
});
