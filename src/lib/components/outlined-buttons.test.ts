import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// A plain `btn` now fills with the page grey and has no border of its own:
// on a white card it all but disappears, on a dark card it reads as a hole.
// Secondary buttons are outlined, so these are too.
const source = (file: string) => readFileSync(new URL(file, import.meta.url), 'utf-8');

describe('secondary buttons', () => {
	it('outlines the stepper and the no-JavaScript language button', () => {
		for (const file of ['./NumberStepper.svelte', './LocaleSelect.svelte']) {
			const buttons = source(file).match(/<button[^>]*class="[^"]*"/g)!;
			expect(buttons.length).toBeGreaterThan(0);
			for (const b of buttons) expect(b).toMatch(/\bbtn-outline\b/);
		}
	});
});
