import { describe, expect, it } from 'vitest';
import { dedupeKey } from './dedupe';

describe('dedupeKey', () => {
	it('prefers the TMDB id when there is one', () => {
		expect(dedupeKey({ tmdbId: 438631, title: 'Dune', year: 2021 })).toBe('tmdb:438631');
	});

	it('falls back to title and year without an id', () => {
		expect(dedupeKey({ title: 'Dune', year: 2021 })).toBe('manual:dune:2021');
	});

	it('treats the same hand-typed film as the same film', () => {
		const a = dedupeKey({ title: 'Dune', year: 2021 });
		const b = dedupeKey({ title: '  dune  ', year: 2021 });
		const c = dedupeKey({ title: 'DUNE', year: 2021 });
		expect(new Set([a, b, c]).size).toBe(1);
	});

	it('collapses punctuation and spacing so near-identical typings collide', () => {
		expect(dedupeKey({ title: 'Spider-Man: No Way Home', year: 2021 })).toBe(
			dedupeKey({ title: 'Spider Man  No Way Home', year: 2021 })
		);
	});

	it('folds diacritics, so the same film typed two ways is one film', () => {
		expect(dedupeKey({ title: 'Amélie', year: 2001 })).toBe(
			dedupeKey({ title: 'Amelie', year: 2001 })
		);
	});

	it('keeps different years apart', () => {
		expect(dedupeKey({ title: 'Dune', year: 2021 })).not.toBe(
			dedupeKey({ title: 'Dune', year: 1984 })
		);
	});

	it('handles a missing year without colliding with a real one', () => {
		expect(dedupeKey({ title: 'Dune' })).toBe('manual:dune:');
		expect(dedupeKey({ title: 'Dune' })).not.toBe(dedupeKey({ title: 'Dune', year: 2021 }));
	});

	it('does not collapse two genuinely different films into one key', () => {
		expect(dedupeKey({ title: 'Dune', year: 2021 })).not.toBe(
			dedupeKey({ title: 'Dune Part Two', year: 2024 })
		);
	});

	it('survives a title with no alphanumeric characters at all', () => {
		expect(dedupeKey({ title: '!!!', year: 2009 })).toBe('manual::2009');
	});
});
