import { render } from 'svelte/server';
import { describe, expect, it } from 'vitest';
import Page from './+page.svelte';

const data = { locale: 'en' as const, redirectTo: '/groups' };
const html = (form: unknown) => render(Page, { props: { data, form } as never }).body;

describe('the sign-in page', () => {
	it('does not offer password help before anything went wrong', () => {
		expect(html(null)).not.toContain('href="/reset"');
	});

	it('offers password help after a failed sign-in', () => {
		expect(html({ error: 'login.failed' })).toContain('href="/reset"');
	});

	it('offers it after too many attempts as well', () => {
		expect(html({ error: 'login.rate_limited' })).toContain('href="/reset"');
	});
});
