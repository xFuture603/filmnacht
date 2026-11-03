import { describe, expect, it } from 'vitest';
import { parseTime, scheduleDefaults, todayIn } from './schedule';

const TZ = 'Europe/Berlin';
// Thursday 1 October 2026, 15:00 in Berlin (CEST, UTC+2).
const NOW = new Date('2026-10-01T13:00:00Z');

describe('todayIn', () => {
	it('is the instance’s date, not UTC’s, just after midnight', () => {
		// 00:30 on 2 October in Berlin is still 1 October in UTC.
		expect(todayIn(new Date('2026-10-01T22:30:00Z'), TZ)).toBe('2026-10-02');
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
		const last = { scheduledAt: new Date('2026-09-24T18:00:00Z'), location: null };
		expect(scheduleDefaults(last, TZ, NOW).day).toBe('2026-10-01');
	});

	it('keeps the wall-clock time across a daylight-saving change', () => {
		// A Friday 20:00 in summer (UTC+2) is still suggested as 20:00 in winter.
		const last = { scheduledAt: new Date('2026-10-23T18:00:00Z'), location: null };
		expect(scheduleDefaults(last, TZ, new Date('2026-10-26T10:00:00Z'))).toMatchObject({
			day: '2026-10-30',
			time: '20:00'
		});
	});
});

describe('parseTime', () => {
	it('reads a typed time however it is written', () => {
		for (const typed of ['19:45', '19.45', '1945', ' 19:45 '])
			expect(parseTime(typed)).toBe('19:45');
		expect(parseTime('7:05')).toBe('07:05');
		expect(parseTime('705')).toBe('07:05');
	});

	it('refuses what is not a time on the 24-hour clock', () => {
		for (const typed of ['25:00', '19:60', '7:45 pm', '', 'soon'])
			expect(parseTime(typed)).toBeNull();
	});
});
