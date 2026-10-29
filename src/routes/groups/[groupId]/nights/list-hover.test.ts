import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// The flat-card reset (app.css) removes every card shadow, so a shadow on
// hover no longer shows. The night cards tint on hover, like the groups list.
const src = readFileSync(new URL('./+page.svelte', import.meta.url), 'utf-8');

describe('the nights list', () => {
	it('tints a night card on hover instead of relying on a shadow', () => {
		const links = src.match(/<a\s[^>]*class="card [^"]*"/g)!;
		expect(links.length).toBeGreaterThan(0);
		for (const a of links) {
			expect(a).toMatch(/\bhover:bg-base-content\/5\b/);
			expect(a).not.toMatch(/\bhover:shadow/);
		}
	});
});
