import { render } from 'svelte/server';
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
});
