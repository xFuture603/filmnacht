import { render } from 'svelte/server';
import { describe, expect, it } from 'vitest';
import { Users } from '@lucide/svelte';
import EmptyState from './EmptyState.svelte';

describe('the empty state', () => {
	// At 40px a 24px icon's lines fall between pixels and blur on 1x screens.
	it('draws its icon at exactly 2x with 1px strokes, so lines land on whole pixels', () => {
		const { body } = render(EmptyState, { props: { icon: Users, text: 'Nothing yet' } });
		const svg = body.match(/<svg[^>]*>/)![0];
		expect(svg).toMatch(/\bsize-12\b/);
		expect(svg).toContain('stroke-width="1"');
	});
});
