import { render } from 'svelte/server';
import { describe, expect, it } from 'vitest';
import Page from './+page.svelte';

const film = {
	tmdbId: 438631,
	title: 'Dune',
	year: 2021,
	posterUrl: null,
	runtime: 155,
	genres: ['Science Fiction', 'Adventure'],
	tmdbRating: 7.8
};
const base = { locale: 'de', group: { groupId: 'g1' }, film, tmdbUrl: 'https://tmdb/m' };
const page = (data: Record<string, unknown>) =>
	render(Page, { props: { data: { ...base, ...data } as never } }).body;

describe('film page', () => {
	it('shows the facts, summary, director, cast and the TMDB credit', () => {
		const body = page({
			details: {
				overview: 'Ein Gewürzkrieg.',
				directors: ['Denis Villeneuve'],
				cast: [
					{ name: 'Timothée Chalamet', character: 'Paul Atreides' },
					{ name: 'Solo', character: null }
				]
			}
		});
		expect(body).toContain('2021 · 155 Min. · Science Fiction, Adventure');
		expect(body).toContain('7,8');
		expect(body).toContain('Ein Gewürzkrieg.');
		expect(body).toContain('Denis Villeneuve');
		expect(body).toContain('Timothée Chalamet als Paul Atreides');
		expect(body).toMatch(/<li>\s*Solo\s*<\/li>/);
		expect(body).toContain('Filmdetails von TMDB');
		expect(body).not.toContain('keine weiteren Details');
	});

	it('says once that a hand-entered film has no more details, with no empty sections', () => {
		const body = page({ details: null, tmdbUrl: null, film: { ...film, tmdbId: null } });
		expect(body).toContain('Für diesen Film gibt es keine weiteren Details');
		expect(body).not.toContain('Regie');
		expect(body).not.toContain('Besetzung');
		expect(body).not.toContain('TMDB<');
	});

	it('says TMDB is unavailable right now when a TMDB film could not be loaded', () => {
		const body = page({ details: null });
		expect(body).toContain('Die Details lassen sich gerade nicht laden');
		expect(body).not.toContain('keine weiteren Details');
	});

	it('treats details with nothing in them like no details', () => {
		const body = page({ details: { overview: null, directors: [], cast: [] } });
		expect(body).toContain('Für diesen Film gibt es keine weiteren Details');
		expect(body).not.toContain('Besetzung');
		expect(body).not.toContain('Regie');
	});

	it('links back to the group with an outlined button, nothing in amber', () => {
		const body = page({ details: null });
		expect(body).toContain('href="/groups/g1"');
		expect(body).toContain('btn btn-outline');
		expect(body).not.toMatch(/btn-primary|text-primary|bg-primary/);
	});
});
