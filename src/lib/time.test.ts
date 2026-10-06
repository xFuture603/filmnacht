import { describe, expect, it } from 'vitest';
import { formatDay, formatWhen, wallTimeToUtc } from './time';

describe('wallTimeToUtc', () => {
	it('reads a summer evening in Berlin as CEST (UTC+2)', () => {
		expect(wallTimeToUtc('2026-07-01T20:00', 'Europe/Berlin')?.toISOString()).toBe(
			'2026-07-01T18:00:00.000Z'
		);
	});

	it('reads a winter evening in Berlin as CET (UTC+1)', () => {
		expect(wallTimeToUtc('2026-12-01T20:00', 'Europe/Berlin')?.toISOString()).toBe(
			'2026-12-01T19:00:00.000Z'
		);
	});

	it('uses the offset in force AFTER a daylight-saving switch on the same day', () => {
		// Berlin springs forward at 02:00 on 2026-03-29; noon that day is already UTC+2.
		expect(wallTimeToUtc('2026-03-29T12:00', 'Europe/Berlin')?.toISOString()).toBe(
			'2026-03-29T10:00:00.000Z'
		);
		// New York springs forward at 07:00Z on 2026-03-08. 05:00 local that morning
		// is already EDT (UTC-4), but the naive guess 05:00Z is still before the
		// switch — only the second pass lands on the right instant.
		expect(wallTimeToUtc('2026-03-08T05:00', 'America/New_York')?.toISOString()).toBe(
			'2026-03-08T09:00:00.000Z'
		);
		// New York falls back on 2026-11-01; noon that day is UTC-5.
		expect(wallTimeToUtc('2026-11-01T12:00', 'America/New_York')?.toISOString()).toBe(
			'2026-11-01T17:00:00.000Z'
		);
	});

	it('is the identity in UTC', () => {
		expect(wallTimeToUtc('2026-07-01T20:00', 'UTC')?.toISOString()).toBe(
			'2026-07-01T20:00:00.000Z'
		);
	});

	it('refuses anything that is not a real wall-clock time', () => {
		for (const bad of ['', 'garbage', '2026-02-30T20:00', '2026-07-01T24:00', '2026-07-01 20:00']) {
			expect(wallTimeToUtc(bad, 'Europe/Berlin')).toBeNull();
		}
	});
});

describe('formatWhen', () => {
	it('renders the instant in the instance timezone, not the server’s', () => {
		const at = new Date('2026-07-01T18:00:00Z');
		expect(formatWhen(at, 'Europe/Berlin', 'en')).toContain('20:00');
		expect(formatWhen(at, 'America/New_York', 'en')).toContain('14:00');
		expect(formatWhen(at, 'Europe/Berlin', 'de')).toContain('Juli');
	});
});

describe('formatDay', () => {
	it('gives a short day in the instance timezone, not the server one', () => {
		// 22:30 UTC on 1 July is already 2 July in Berlin.
		const at = new Date('2030-07-01T22:30:00Z');
		expect(formatDay(at, 'Europe/Berlin', 'en')).toBe('2 Jul');
		expect(formatDay(at, 'Europe/Berlin', 'de')).toBe('2. Juli');
	});
});
