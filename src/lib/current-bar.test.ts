import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('the current-place bar', () => {
	it('is drawn in the ink colour under the label', () => {
		const css = readFileSync('src/app.css', 'utf8');
		expect(css).toMatch(/\.current-bar::after\s*\{[^}]*background-color:\s*currentColor/);
	});

	it('marks the current item of the desktop navigation', () => {
		const layout = readFileSync('src/routes/+layout.svelte', 'utf8');
		expect(layout).toMatch(/s\.current && '[^']*\bcurrent-bar\b/);
	});
});
