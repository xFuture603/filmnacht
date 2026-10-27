import { render } from 'svelte/server';
import { describe, expect, it } from 'vitest';
import Poster from './Poster.svelte';

describe('Poster placeholder', () => {
	const svg = () => render(Poster, { props: { src: null } }).body.match(/<svg[^>]*>/)?.[0] ?? '';

	it('draws the 24px icon at exactly 2x with 1px strokes, so lines land on whole pixels', () => {
		expect(svg()).toMatch(/class="[^"]*\bsize-12\b/);
		expect(svg()).toContain('stroke-width="1"');
	});

	it('fades the whole icon, so crossing lines do not darken', () => {
		expect(svg()).toMatch(/class="[^"]*\bopacity-25\b/);
		expect(svg()).not.toMatch(/text-base-content\/\d+/);
	});
});
