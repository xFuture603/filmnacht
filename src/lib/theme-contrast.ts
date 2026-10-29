import { readFileSync } from 'node:fs';

/**
 * WCAG contrast checks against the theme colours in app.css itself, for tests:
 * a colour change there fails the test that depends on it.
 */

export const themes = ['filmnacht-light', 'filmnacht-dark'] as const;

const css = readFileSync('src/app.css', 'utf8');

export type Rgb = number[];

export function token(theme: string, name: string): Rgb {
	const block = css.slice(css.indexOf(`name: '${theme}'`));
	const m = block.match(new RegExp(`--color-${name}: #([0-9a-f]{6})`));
	return [0, 2, 4].map((i) => parseInt(m![1].slice(i, i + 2), 16));
}

/** `fg` at `alpha` opacity laid over `bg`. */
export function over(fg: Rgb, alpha: number, bg: Rgb): Rgb {
	return fg.map((v, i) => v * alpha + bg[i] * (1 - alpha));
}

function lum(c: Rgb): number {
	const [r, g, b] = c.map((v) => {
		v /= 255;
		return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
	});
	return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function ratio(a: Rgb, b: Rgb): number {
	const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
	return (hi + 0.05) / (lo + 0.05);
}
