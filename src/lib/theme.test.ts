import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ratio, themes, token } from './theme-contrast';

describe('the theme', () => {
	// Status colours are text on cards and on the page (icons, soft alerts), and
	// fills behind their own content colour (toasts, badges): WCAG AA 4.5:1 for all.
	it('keeps every status colour at 4.5:1 or more as text and as a fill', () => {
		for (const theme of themes) {
			for (const status of ['info', 'success', 'error']) {
				const colour = token(theme, status);
				expect(ratio(colour, token(theme, 'base-100'))).toBeGreaterThanOrEqual(4.5);
				expect(ratio(colour, token(theme, 'base-200'))).toBeGreaterThanOrEqual(4.5);
				expect(ratio(colour, token(theme, `${status}-content`))).toBeGreaterThanOrEqual(4.5);
			}
		}
	});

	// The pill behind the selected phone tab is a faint tint, far below 3:1, so
	// the bar under it is what shows where you are (WCAG 1.4.11).
	it('keeps the bar under the selected phone tab', () => {
		const css = readFileSync('src/app.css', 'utf8');
		expect(css).not.toMatch(/dock-active[^}]*::after\s*\{\s*display:\s*none/);
	});
});
