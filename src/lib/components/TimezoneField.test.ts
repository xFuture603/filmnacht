import { render } from 'svelte/server';
import { describe, expect, it } from 'vitest';
import TimezoneField from './TimezoneField.svelte';

describe('TimezoneField', () => {
	it('is a text field with suggestions, not a 400-entry dropdown', () => {
		const { body } = render(TimezoneField, {
			props: {
				label: 'Timezone',
				hint: 'Start typing a city',
				timezones: ['Europe/Berlin', 'Europe/London'],
				value: 'Europe/Berlin'
			}
		});
		expect(body).not.toContain('<select');
		expect(body).toMatch(/<input[^>]*name="timezone"[^>]*list="timezones"/);
		expect(body).toContain('value="Europe/Berlin"');
		expect(body).toContain('<datalist id="timezones">');
		expect(body).toContain('<option value="Europe/London">');
	});
});
