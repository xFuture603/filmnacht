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

	// daisyUI rings a focused button in its own colour: amber on the light page
	// is about 2:1. Primary buttons ring in ink instead.
	it('rings a focused primary button in ink, not amber', () => {
		const css = readFileSync('src/app.css', 'utf8');
		expect(css).toMatch(/\.btn-primary\s*\{[^}]*outline-color:\s*var\(--color-base-content\)/);
	});

	// daisyUI pushes dock items up with a bottom margin, so inside the padded
	// capsule the selected pill touched the top edge.
	it('centres the phone tab bar items in the capsule', () => {
		const css = readFileSync('src/app.css', 'utf8');
		const dock = css.slice(css.indexOf('.dock {'));
		expect(dock).toMatch(/>\s*\*\s*\{[^}]*margin-bottom:\s*0/);
	});
});

// iOS rubber-bands past the end of the page and shows the root behind it.
// daisyUI paints the root in base-100, a grey next to the black page in dark
// mode; the browser bars are tinted to match the page too.
describe('behind the page', () => {
	it('is the page colour, not the card colour', () => {
		const css = readFileSync('src/app.css', 'utf8');
		expect(css).toMatch(/:root\s*\{[^}]*--root-bg:\s*var\(--color-base-200\)/);
	});

	it('tints the browser bars in the page colour', () => {
		const html = readFileSync('src/app.html', 'utf8');
		const hex = (rgb: number[]) => '#' + rgb.map((c) => c.toString(16).padStart(2, '0')).join('');
		for (const [scheme, theme] of [
			['light', 'filmnacht-light'],
			['dark', 'filmnacht-dark']
		]) {
			const meta = html.match(
				new RegExp(
					`theme-color" content="(#[0-9a-f]{6})" media="\\(prefers-color-scheme: ${scheme}\\)`
				)
			);
			expect(meta?.[1], scheme).toBe(hex(token(theme, 'base-200')));
		}
	});
});
