import { readFileSync } from 'node:fs';
import { render } from 'svelte/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('$app/forms', () => ({ enhance: () => ({}) }));
vi.mock('$app/navigation', () => ({ invalidateAll: () => Promise.resolve() }));

const { default: Page } = await import('./+page.svelte');

const entry = (over: Record<string, unknown>) => ({
	suggestionId: 's1',
	title: 'Dune',
	year: 2021,
	posterUrl: null,
	runtime: 155,
	mine: false,
	status: 'open',
	night: null,
	isNew: false,
	drawnFor: null,
	...over
});

function body(pool: unknown[]) {
	return render(Page, {
		props: {
			data: {
				locale: 'en',
				group: { groupId: 'g1', name: 'Filmnacht', role: 'member' },
				members: [],
				pool,
				newCounts: {},
				toRate: [],
				next: null,
				used: 0,
				max: 3
			} as never,
			form: null
		}
	}).body;
}

describe('the pool', () => {
	it("links each film's title to its page", () => {
		expect(body([entry({})])).toMatch(/<a[^>]*href="\/groups\/g1\/films\/s1"[^>]*>\s*Dune\s*<\/a>/);
	});

	it('keeps the withdraw button outside the link and above it', () => {
		const html = body([entry({ mine: true })]);
		const link = html.match(/<a[^>]*href="\/groups\/g1\/films\/s1"[^>]*>[\s\S]*?<\/a>/)?.[0] ?? '';
		expect(link).not.toContain('<button');
		expect(html).toMatch(/<form[^>]*action="\?\/withdraw"[^>]*class="[^"]*z-10/);
		// Its own stacking context per tile: without it the z-10 dot would paint
		// over the sticky header and the phone dock while scrolling.
		expect(html).toMatch(/<li class="[^"]*\bisolate\b/);
	});

	it('lifts the poster on hover and on keyboard focus, without amber', () => {
		const html = body([entry({})]);
		const poster =
			html.match(
				/<div class="([^"]*)">\s*(?:<!--[^>]*-->\s*)*<(?:img|div)[^>]*aspect-\[2\/3\]/
			)?.[1] ?? '';
		expect(poster).toContain('group-hover/tile:shadow-md');
		expect(poster).toContain('group-hover/tile:ring-1');
		expect(poster).toContain('group-hover/tile:ring-base-content/50');
		expect(poster).toContain('group-has-[a:focus-visible]/tile:ring-base-content/50');
		expect(poster).toContain('group-has-[a:focus-visible]/tile:shadow-md');
		expect(poster).not.toMatch(/primary|warning|amber/);
		expect(html).toMatch(/<li class="[^"]*\bgroup\/tile\b/);
	});

	// WCAG 1.4.11: a visual cue needs 3:1 against what is next to it. The ring sits
	// just outside the poster, on the page background, and next to the poster's
	// edge, which can be pure white. Checked in both themes from app.css itself.
	it('keeps the hover ring at 3:1 or more in both themes, whatever the poster', () => {
		const html = body([entry({})]);
		const alpha = Number(html.match(/group-hover\/tile:ring-base-content\/(\d+)/)?.[1]) / 100;
		const css = readFileSync('src/app.css', 'utf8');
		const hex = (theme: string, token: string) => {
			const block = css.slice(css.indexOf(`name: '${theme}'`));
			const m = block.match(new RegExp(`--color-${token}: #([0-9a-f]{6})`));
			return [0, 2, 4].map((i) => parseInt(m![1].slice(i, i + 2), 16));
		};
		const lum = (c: number[]) => {
			const [r, g, b] = c.map((v) => {
				v /= 255;
				return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
			});
			return 0.2126 * r + 0.7152 * g + 0.0722 * b;
		};
		const ratio = (a: number[], b: number[]) => {
			const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
			return (hi + 0.05) / (lo + 0.05);
		};
		for (const theme of ['filmnacht-light', 'filmnacht-dark']) {
			const page = hex(theme, 'base-200');
			const ring = hex(theme, 'base-content').map((v, i) => v * alpha + page[i] * (1 - alpha));
			expect(ratio(ring, page)).toBeGreaterThanOrEqual(3);
			expect(ratio(ring, [255, 255, 255])).toBeGreaterThanOrEqual(3);
		}
	});
});
