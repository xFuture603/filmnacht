import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * A markup-level regression guard for the bug this file's sibling fix
 * addressed: `Field` wraps its children in its own `<label>`, so a checkbox
 * placed inside it sits in a label nested inside another label — skipped by
 * the accessible-name computation, so the toggle announces its hint text
 * instead of its name (e.g. "Automatic draw"). No component-rendering
 * harness exists in this repo (no @testing-library/svelte), and the plan
 * adds no dependencies, so this reads the source text directly rather than
 * rendering it — cheap, and it fails loudly if a toggle is ever wrapped in
 * `Field` again.
 */
const src = readFileSync(new URL('./+page.svelte', import.meta.url), 'utf-8');

describe('settings page markup', () => {
	it('never wraps a checkbox in Field', () => {
		const fieldBlocks = src.match(/<Field[\s\S]*?<\/Field>/g) ?? [];
		expect(fieldBlocks.length).toBeGreaterThan(0); // the four <select> fields still use it
		for (const block of fieldBlocks) {
			expect(block).not.toContain('type="checkbox"');
		}
	});

	it('ties every toggle checkbox to a real hint via aria-describedby', () => {
		for (const [name, hintId] of [
			['autoDraw', 'auto-draw-hint'],
			['surprise', 'surprise-hint'],
			['fairDraw', 'fair-draw-hint']
		]) {
			const input = src.match(new RegExp(`name="${name}"[\\s\\S]*?/>`));
			expect(input?.[0]).toContain(`aria-describedby="${hintId}"`);
			expect(src).toContain(`id="${hintId}"`);
		}
	});
});
