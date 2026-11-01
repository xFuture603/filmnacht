import { render } from 'svelte/server';
import { describe, expect, it } from 'vitest';
import AnswerPicker from './AnswerPicker.svelte';

const html = (current: 'yes' | 'maybe' | 'no' | null, locale: 'en' | 'de' = 'en') =>
	render(AnswerPicker, { props: { current, locale } }).body;
const buttons = (body: string) => body.match(/<button[\s\S]*?<\/button>/g) ?? [];

// The answer to a night is one choice out of three: the segmented control the
// group tabs already use, not a row of outlined buttons with a dark fill.
describe('the answer picker', () => {
	it('offers yes, maybe and no as answers to submit, in both languages', () => {
		const en = buttons(html(null));
		expect(en.map((b) => b.match(/value="(\w+)"/)?.[1])).toEqual(['yes', 'maybe', 'no']);
		for (const b of en) expect(b).toContain('name="response"');
		expect(buttons(html(null, 'de')).map((b) => b.replace(/<[^>]+>/g, '').trim())).toEqual([
			'Ja',
			'Vielleicht',
			'Nein'
		]);
	});

	it('sits on the grey track of a segmented control', () => {
		expect(html(null)).toMatch(/<div[^>]*class="[^"]*\btabs\b[^"]*\btabs-box\b/);
		for (const b of buttons(html(null))) expect(b).toMatch(/class="[^"]*\btab\b/);
	});

	// Raised in white is a faint cue on its own; the check mark says it too.
	it('raises the chosen answer and marks it with a check, never in amber', () => {
		const [yes, maybe, no] = buttons(html('maybe'));
		expect(maybe).toMatch(/\btab-active\b/);
		expect(maybe).toContain('aria-pressed="true"');
		expect(maybe).toContain('<svg');
		for (const other of [yes, no]) {
			expect(other).not.toMatch(/\btab-active\b/);
			expect(other).toContain('aria-pressed="false"');
			expect(other).not.toContain('<svg');
		}
		expect(html('maybe')).not.toContain('btn-primary');
	});

	it('keeps every answer a 48px target that may wrap its label', () => {
		for (const b of buttons(html(null)))
			expect(b).toMatch(/\bmin-h-12\b[\s\S]*\bh-auto\b|\bh-auto\b[\s\S]*\bmin-h-12\b/);
	});
});
