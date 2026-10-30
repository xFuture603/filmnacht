import { render } from 'svelte/server';
import { describe, expect, it } from 'vitest';
import Page from './+page.svelte';

const film = (tmdbId: number, title: string) => ({
	tmdbId,
	title,
	year: 2021,
	posterUrl: null,
	tmdbRating: null
});

function page(locale: 'en' | 'de', results?: unknown[]) {
	return render(Page, {
		props: {
			data: {
				locale,
				group: { groupId: 'g1', name: 'Kino', role: 'member' },
				noteMax: 200,
				tmdbEnabled: true
			} as never,
			form: results ? ({ results, query: 'x' } as never) : null
		}
	}).body;
}

/** The text of the polite status region that announces the results. */
const status = (html: string) =>
	html.match(/<p class="sr-only" role="status" aria-live="polite">([^<]*)<\/p>/)?.[1];

describe('the search results status', () => {
	// Results now change while you type, which a screen reader does not notice
	// on its own: a status region says how many there are.
	it('is there, empty, before anything is searched', () => {
		expect(status(page('en'))).toBe('');
	});

	it('says how many films were found, in both languages', () => {
		const two = [film(1, 'Dune'), film(2, 'Dune: Part Two')];
		expect(status(page('en', two))).toBe('2 films found');
		expect(status(page('de', two))).toBe('2 Filme gefunden');
		expect(status(page('en', [film(1, 'Dune')]))).toBe('1 film found');
		expect(status(page('de', [film(1, 'Dune')]))).toBe('1 Film gefunden');
	});

	it('says when nothing was found', () => {
		expect(status(page('en', []))).toBe('Nothing found. Type it in below instead.');
	});
});

describe('the search field', () => {
	// A real search field: browsers add a clear button, and phone keyboards
	// label their return key "Search".
	it('is a search input with a search return key', () => {
		const input = page('en').match(/<input[^>]*name="query"[^>]*>/)?.[0] ?? '';
		expect(input).toContain('type="search"');
		expect(input).toContain('enterkeyhint="search"');
	});
});
