import { render } from 'svelte/server';
import { describe, expect, it } from 'vitest';
import PageHeader from './PageHeader.svelte';
import FormCard from './FormCard.svelte';
import { createRawSnippet } from 'svelte';

describe('page titles', () => {
	it('names the browser tab after the page heading', () => {
		const { head } = render(PageHeader, { props: { title: 'Profile' } });
		expect(head).toContain('<title>Profile · Filmnacht</title>');
	});

	it('does the same for form pages', () => {
		const children = createRawSnippet(() => ({ render: () => '<p></p>' }));
		const { head } = render(FormCard, { props: { title: 'Sign in', children } });
		expect(head).toContain('<title>Sign in · Filmnacht</title>');
	});
});

describe('the page heading on narrow phones', () => {
	// A long German title at 34px took five lines on a 320px phone.
	it('is a step smaller on phones', () => {
		const { body } = render(PageHeader, { props: { title: 'Profile' } });
		const h1 = body.match(/<h1 class="([^"]*)"/)![1].split(' ');
		expect(h1).toEqual(expect.arrayContaining(['text-3xl', 'sm:text-[2.125rem]']));
	});
});
