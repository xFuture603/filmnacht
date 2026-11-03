import { render } from 'svelte/server';
import { describe, expect, it } from 'vitest';
import Scheduler from './Scheduler.svelte';

const props = {
	locale: 'en' as const,
	today: '2026-10-29',
	defaults: { day: '2026-10-30', time: '20:00', location: "Ada's sofa" },
	locationMax: 100,
	echo: undefined
};

describe('the schedule form', () => {
	// The device's own pickers: a typed or spun time, not a list of slots.
	it('uses native date and time fields, filled with the suggestion', () => {
		const { body } = render(Scheduler, { props });
		expect(body).toMatch(
			/<input[^>]*type="date"[^>]*name="day"[^>]*required[^>]*min="2026-10-29"[^>]*value="2026-10-30"/
		);
		expect(body).toMatch(/<input[^>]*type="time"[^>]*name="time"[^>]*required[^>]*value="20:00"/);
		expect(body).toMatch(/<input[^>]*name="location"[^>]*value="Ada's sofa"/);
	});

	it('leaves the day empty for a group that has never met', () => {
		const { body } = render(Scheduler, {
			props: { ...props, defaults: { ...props.defaults, day: null } }
		});
		expect(body).toMatch(/<input[^>]*type="date"[^>]*value=""/);
	});

	it('gives a failed submit back what was entered', () => {
		const { body } = render(Scheduler, {
			props: { ...props, echo: { day: '2026-11-02', time: '21:15', location: 'Kino' } }
		});
		expect(body).toContain('value="2026-11-02"');
		expect(body).toContain('value="21:15"');
		expect(body).toContain('value="Kino"');
	});
});
