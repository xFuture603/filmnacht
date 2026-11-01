import { describe, expect, it } from 'vitest';

// Nothing below 14px, and every control a 48px target. daisyUI's small badge
// sets 12px text; a 36px close button is hard to hit with a thumb.
import { readFileSync } from 'node:fs';

const sources = import.meta.glob('/src/**/*.svelte', {
	query: '?raw',
	import: 'default',
	eager: true
}) as Record<string, string>;

describe('the size floor', () => {
	it('uses no small badge anywhere', () => {
		const small = Object.entries(sources).filter(([, s]) => /\bbadge-sm\b/.test(s));
		expect(small.map(([path]) => path)).toEqual([]);
	});

	it('uses no 12px icon anywhere', () => {
		const tiny = Object.entries(sources).filter(([, s]) =>
			/<[A-Z]\w*[^>]*class="[^"]*\bsize-3\b/.test(s)
		);
		expect(tiny.map(([path]) => path)).toEqual([]);
	});

	it('gives the toast close button a 48px target', () => {
		const toast = sources['/src/lib/components/Toast.svelte'];
		const close = toast.match(/<button[\s\S]*?>/)?.[0] ?? '';
		expect(close).toMatch(/\bsize-12\b/);
		expect(close).not.toMatch(/\b(size-9|min-h-9|btn-sm)\b/);
	});

	it('uses no small button or extra-small text anywhere', () => {
		const small = Object.entries(sources).filter(([, s]) => /\b(btn-sm|btn-xs|text-xs)\b/.test(s));
		expect(small.map(([path]) => path)).toEqual([]);
	});

	// daisyUI's square button is 40px wide whatever its height.
	it('makes every square button 48px wide too', () => {
		for (const [path, source] of Object.entries(sources)) {
			for (const cls of source.match(/class="[^"]*\bbtn-square\b[^"]*"/g) ?? []) {
				expect(cls, path).toMatch(/\bsize-12\b/);
			}
		}
	});

	it('sets the tab bar labels at 14px', () => {
		const css = readFileSync('src/app.css', 'utf8');
		expect(css).toMatch(/\.dock-label\s*\{[^}]*font-size:\s*0\.875rem/);
	});

	// app.css flattens every card: a border or shadow class on one does nothing.
	it('puts no dead border or shadow utilities on cards', () => {
		for (const [path, source] of Object.entries(sources)) {
			for (const cls of source.match(/(class="|')card [^"']*["']/g) ?? []) {
				expect(cls, path).not.toMatch(/\b(border-base-300|shadow-sm)\b/);
			}
		}
	});
});
