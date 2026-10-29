import { render } from 'svelte/server';
import { describe, expect, it } from 'vitest';
import Scheduler from './Scheduler.svelte';

describe('the day picker', () => {
	// Day cells are narrower than their 48px height on phones and wider on
	// desktop, so a capsule turned the selected day into an oval either way.
	it('marks days with a rounded square, not a capsule', () => {
		const { body } = render(Scheduler, {
			props: {
				locale: 'de',
				timezone: 'Europe/Berlin',
				today: '2026-10-29',
				initialMonth: '2026-10',
				defaults: { day: '2026-10-30', time: '20:00', location: '' },
				usualTime: null,
				locationMax: 100,
				echo: undefined
			}
		});
		const days = body.match(/<span class="btn btn-ghost[^"]*"/g)!;
		expect(days.length).toBeGreaterThan(0);
		for (const d of days) expect(d).toMatch(/\brounded-xl\b/);
	});
});
