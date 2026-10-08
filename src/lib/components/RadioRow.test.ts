import { render } from 'svelte/server';
import { describe, expect, it } from 'vitest';
import RadioRow from './RadioRow.svelte';

describe('RadioRow', () => {
	it('renders conventional radio buttons with visible labels, not buttons', () => {
		const { body } = render(RadioRow, {
			props: {
				legend: 'Rating stays open',
				name: 'ratingWindowDays',
				value: 7,
				options: [
					{ value: 3, label: '3 days' },
					{ value: 7, label: '7 days' }
				]
			}
		});
		// Practical UI: keep the radio circle so one-of-many reads as one-of-many.
		expect(body).toContain('class="radio');
		expect(body).not.toContain('class="btn');
		expect(body).toContain('>3 days<');
		expect(body.match(/checked/g)).toHaveLength(1);
	});
});
