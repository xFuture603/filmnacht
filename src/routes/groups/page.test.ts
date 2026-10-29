import { render } from 'svelte/server';
import { over, ratio, themes, token } from '$lib/theme-contrast';
import { describe, expect, it } from 'vitest';
import Page from './+page.svelte';

describe('the groups list', () => {
	it('marks the groups you own with the outlined badge the other info badges use', () => {
		const body = render(Page, {
			props: {
				data: {
					locale: 'en',
					groups: [{ id: 'g1', name: 'Filmnacht', role: 'owner', newCount: 0 }]
				} as never,
				form: null
			}
		}).body;
		expect(body).toMatch(/<span class="badge badge-sm badge-outline">Owner<\/span>/);
	});

	// The chevron is the row's only sign that it opens something, so it is a
	// graphic you need to see: 3:1 against the list in both themes (WCAG 1.4.11).
	it('keeps the row chevron at 3:1 or more in both themes', () => {
		const body = render(Page, {
			props: {
				data: {
					locale: 'en',
					groups: [{ id: 'g1', name: 'Filmnacht', role: 'member', newCount: 0 }]
				} as never,
				form: null
			}
		}).body;
		const alpha =
			Number(body.match(/lucide-chevron-right[^"]*text-base-content\/(\d+)/)?.[1]) / 100;
		for (const theme of themes) {
			const list = token(theme, 'base-100');
			expect(ratio(over(token(theme, 'base-content'), alpha, list), list)).toBeGreaterThanOrEqual(
				3
			);
		}
	});
});
