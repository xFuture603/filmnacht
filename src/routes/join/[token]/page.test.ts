import { render } from 'svelte/server';
import { describe, expect, it } from 'vitest';
import Page from './+page.svelte';

const page = (data: Record<string, unknown>) =>
	render(Page, {
		props: { data: { locale: 'en', user: null, token: 't', ...data } as never, form: null }
	}).body;

describe('the join page when it cannot be used', () => {
	const states = {
		invalid: { invite: null, rateLimited: false },
		'rate limited': { invite: null, rateLimited: true }
	};

	// A screen reader user jumps to the h1 first; without one the page has no name.
	it.each(Object.entries(states))('has a page heading when %s', (_, data) => {
		expect(page(data)).toMatch(/<h1[^>]*>[^<]+<\/h1>/);
	});

	// Amber text on a light amber ground is about 2:1.
	it('reports too many attempts without amber text', () => {
		const html = page(states['rate limited']);
		expect(html).not.toContain('alert-warning');
		expect(html).toMatch(/alert-error alert-soft/);
	});
});
