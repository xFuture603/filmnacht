import { render } from 'svelte/server';
import { describe, expect, it } from 'vitest';
import Page from './+page.svelte';

const film = {
	tmdbId: 438631,
	title: 'Dune',
	year: 2021,
	posterUrl: null,
	runtime: 155,
	genres: ['Science Fiction'],
	tmdbRating: 7.8
};
const page = (data: Record<string, unknown>) =>
	render(Page, {
		props: {
			data: {
				locale: 'en',
				group: { groupId: 'g1', name: 'Kino' },
				film,
				details: { overview: 'A spice war.', directors: [], cast: [] },
				tmdbUrl: 'https://tmdb/m',
				taken: false,
				capped: false,
				...data
			} as never
		}
	}).body;

describe('a film from the search', () => {
	it('shows its details and a button that adds it', () => {
		const body = page({});
		expect(body).toContain('A spice war.');
		expect(body).toContain('action="/groups/g1/add?/adopt"');
		expect(body).toContain('value="438631"');
		expect(body).toContain('Back to the search');
	});

	it('says so instead when it cannot be added', () => {
		expect(page({ taken: true })).toContain('Already suggested');
		expect(page({ taken: true })).not.toContain('?/adopt');
		expect(page({ capped: true })).not.toContain('?/adopt');
	});

	it('shows only the invitation when signed out, with the film only in the preview tags', () => {
		const { head, body } = render(Page, {
			props: {
				data: {
					locale: 'en',
					pathname: '/groups/g1/add/film/438631',
					preview: { title: 'Dune (2021)', image: 'https://img/dune.jpg' },
					question: 'Why?'
				} as never
			}
		});
		expect(head).toContain('property="og:title" content="Dune (2021)"');
		expect(head).toContain('property="og:image" content="https://img/dune.jpg"');
		expect(body).toContain('You need an invitation');
		expect(body).not.toContain('Dune');
	});
});
