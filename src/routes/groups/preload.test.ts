import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Opening the Films or Nights page marks its items as seen (new-markers spec),
 * and SvelteKit runs a page's server load when it preloads a link — on hover,
 * or on touchstart while scrolling on a phone. So every link to those two
 * pages must switch preloading off, or merely passing over it clears a tab.
 */

const root = 'src';
const svelteFiles = readdirSync(root, { recursive: true, encoding: 'utf8' })
	.filter((file) => file.endsWith('.svelte'))
	.map((file) => join(root, file));

// The Films page is /groups/<id>, the Nights page /groups/<id>/nights. GroupTabs
// builds its hrefs in script, so its {tab.href} links count too.
const marksSeen = /href=("\/groups\/\{[^}]+\}(\/nights)?"|\{tab\.href\})/;

const offenders = svelteFiles.flatMap((file) =>
	[...readFileSync(file, 'utf8').matchAll(/<a\b[^>]*>/gs)]
		.map((match) => match[0])
		.filter((tag) => marksSeen.test(tag) && !tag.includes('data-sveltekit-preload-data="off"'))
		.map((tag) => `${file}: ${tag.replace(/\s+/g, ' ').slice(0, 120)}`)
);

describe('links that mark a tab as seen', () => {
	it('finds the links it is meant to guard', () => {
		const guarded = svelteFiles.filter((file) => marksSeen.test(readFileSync(file, 'utf8')));
		expect(guarded.length).toBeGreaterThanOrEqual(4);
	});

	it('never preload', () => {
		expect(offenders).toEqual([]);
	});
});
