import { describe, expect, it } from 'vitest';
import { dayOptions, pickWhen, scheduleDefaults, timeOptions } from './schedule';

const TZ = 'Europe/Berlin';
// Thursday 1 October 2026, 15:00 in Berlin (CEST, UTC+2).
const NOW = new Date('2026-10-01T13:00:00Z');

describe('dayOptions', () => {
	it('lists the next 14 calendar days in the instance timezone, starting today', () => {
		const days = dayOptions(NOW, TZ, 'en');
		expect(days).toHaveLength(14);
		expect(days[0]).toEqual({ value: '2026-10-01', label: 'Today' });
		expect(days[1]).toEqual({ value: '2026-10-02', label: 'Tomorrow' });
		expect(days[2]).toEqual({ value: '2026-10-03', label: 'Sat 3 Oct' });
		// The month only where it changes, so every chip stays one short line.
		expect(days[3].label).toBe('Sun 4');
		expect(days[13].value).toBe('2026-10-14');
	});

	it('uses the instance’s date, not UTC’s, just after midnight', () => {
		// 00:30 on 2 October in Berlin is still 1 October in UTC.
		const days = dayOptions(new Date('2026-10-01T22:30:00Z'), TZ, 'en');
		expect(days[0].value).toBe('2026-10-02');
	});

	it('counts calendar days across the end of daylight saving time', () => {
		// Berlin falls back on 25 October 2026; a day list spanning it must not
		// skip or repeat a date.
		const days = dayOptions(new Date('2026-10-20T10:00:00Z'), TZ, 'en').map((d) => d.value);
		expect(days.slice(4, 7)).toEqual(['2026-10-24', '2026-10-25', '2026-10-26']);
		expect(new Set(days).size).toBe(14);
	});

	it('names the month again on the 1st', () => {
		const days = dayOptions(new Date('2026-09-25T10:00:00Z'), TZ, 'en');
		expect(days.find((d) => d.value === '2026-10-01')?.label).toBe('Thu 1 Oct');
		expect(days.find((d) => d.value === '2026-09-30')?.label).toBe('Wed 30');
	});

	it('speaks German', () => {
		const days = dayOptions(NOW, TZ, 'de');
		expect(days[0].label).toBe('Heute');
		expect(days[1].label).toBe('Morgen');
		expect(days[2].label).toBe('Sa. 3. Okt.');
		expect(days[3].label).toBe('So. 4.');
	});
});

describe('timeOptions', () => {
	it('offers the evening in half hours', () => {
		expect(timeOptions(null)).toEqual([
			'18:00',
			'18:30',
			'19:00',
			'19:30',
			'20:00',
			'20:30',
			'21:00',
			'21:30'
		]);
	});

	it('adds the group’s usual time when it is not already there, in order', () => {
		expect(timeOptions('19:45')).toContain('19:45');
		expect(timeOptions('19:45').indexOf('19:45')).toBe(4);
		expect(timeOptions('20:00')).toHaveLength(8);
	});
});

describe('scheduleDefaults', () => {
	it('suggests 20:00 and no day for a group that has never met', () => {
		expect(scheduleDefaults(null, TZ, NOW)).toEqual({ day: null, time: '20:00', location: '' });
	});

	it('suggests the next date on the usual weekday, at the usual time and place', () => {
		// The last night was a Friday at 19:30 Berlin time.
		const last = { scheduledAt: new Date('2026-09-25T17:30:00Z'), location: 'Ada’s sofa' };
		expect(scheduleDefaults(last, TZ, NOW)).toEqual({
			day: '2026-10-02',
			time: '19:30',
			location: 'Ada’s sofa'
		});
	});

	it('skips today when the usual time has already passed', () => {
		// Last night: a Thursday at 14:00 — NOW is Thursday 15:00, so next week.
		const last = { scheduledAt: new Date('2026-09-24T12:00:00Z'), location: null };
		expect(scheduleDefaults(last, TZ, NOW).day).toBe('2026-10-08');
	});

	it('keeps today when the usual time is still ahead', () => {
		// Last night: a Thursday at 20:00 — NOW is Thursday 15:00.
		const last = { scheduledAt: new Date('2026-09-24T18:00:00Z'), location: null };
		expect(scheduleDefaults(last, TZ, NOW).day).toBe('2026-10-01');
	});

	it('keeps the wall-clock time across a daylight-saving change', () => {
		// A Friday 20:00 in summer (UTC+2) is still suggested as 20:00 in winter.
		const last = { scheduledAt: new Date('2026-10-23T18:00:00Z'), location: null };
		const defaults = scheduleDefaults(last, TZ, new Date('2026-10-26T10:00:00Z'));
		expect(defaults).toMatchObject({ day: '2026-10-30', time: '20:00' });
	});
});

describe('pickWhen', () => {
	it('combines the chosen day and time', () => {
		expect(pickWhen({ day: '2026-10-02', time: '20:00', otherDay: '', otherTime: '' })).toBe(
			'2026-10-02T20:00'
		);
	});

	it('lets the other date and time win over the chips', () => {
		expect(
			pickWhen({ day: '2026-10-02', time: '20:00', otherDay: '2026-12-24', otherTime: '18:15' })
		).toBe('2026-12-24T18:15');
		// Filling only one of them still overrides just that part.
		expect(pickWhen({ day: '2026-10-02', time: '20:00', otherDay: '', otherTime: '18:15' })).toBe(
			'2026-10-02T18:15'
		);
	});

	it('returns something wallTimeToUtc will refuse when a part is missing', () => {
		expect(pickWhen({ day: '', time: '20:00', otherDay: '', otherTime: '' })).toBe('T20:00');
	});
});
