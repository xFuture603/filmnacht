import { describe, expect, it } from 'vitest';
import {
	monthGrid,
	monthTitle,
	pickWhen,
	scheduleDefaults,
	shiftMonth,
	timeSlots,
	todayIn,
	weekdayNames
} from './schedule';

const TZ = 'Europe/Berlin';
// Thursday 1 October 2026, 15:00 in Berlin (CEST, UTC+2).
const NOW = new Date('2026-10-01T13:00:00Z');

describe('monthGrid', () => {
	it('lays a month out in Monday-first weeks, with blanks around it', () => {
		// October 2026 starts on a Thursday and has 31 days.
		const weeks = monthGrid('2026-10', '2026-10-01');
		expect(weeks[0].slice(0, 3)).toEqual([null, null, null]);
		expect(weeks[0][3]).toMatchObject({ date: '2026-10-01', day: 1, today: true, past: false });
		expect(weeks.every((w) => w.length === 7)).toBe(true);
		expect(weeks.flat().filter((c) => c !== null)).toHaveLength(31);
		expect(
			weeks
				.at(-1)
				?.filter((c) => c !== null)
				.at(-1)?.date
		).toBe('2026-10-31');
	});

	it('handles a month that starts on a Monday and a leap February', () => {
		expect(monthGrid('2027-02', '2026-10-01')[0][0]?.date).toBe('2027-02-01');
		expect(
			monthGrid('2028-02', '2026-10-01')
				.flat()
				.filter((c) => c !== null)
		).toHaveLength(29);
	});

	it('marks the days before today as past', () => {
		const cells = monthGrid('2026-10', '2026-10-15').flat();
		expect(cells.find((c) => c?.date === '2026-10-14')?.past).toBe(true);
		expect(cells.find((c) => c?.date === '2026-10-15')).toMatchObject({ past: false, today: true });
		expect(cells.find((c) => c?.date === '2026-10-16')?.past).toBe(false);
	});
});

describe('shiftMonth', () => {
	it('steps across year boundaries', () => {
		expect(shiftMonth('2026-12', 1)).toBe('2027-01');
		expect(shiftMonth('2027-01', -1)).toBe('2026-12');
	});
});

describe('labels', () => {
	it('names the month and the Monday-first weekdays in both languages', () => {
		expect(monthTitle('2026-10', 'en')).toBe('October 2026');
		expect(monthTitle('2026-10', 'de')).toBe('Oktober 2026');
		expect(weekdayNames('en')).toEqual(['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']);
		expect(weekdayNames('de')[0]).toBe('Mo');
		expect(weekdayNames('de')[6]).toBe('So');
	});
});

describe('todayIn', () => {
	it('is the instance’s date, not UTC’s, just after midnight', () => {
		// 00:30 on 2 October in Berlin is still 1 October in UTC.
		expect(todayIn(new Date('2026-10-01T22:30:00Z'), TZ)).toBe('2026-10-02');
	});
});

describe('timeSlots', () => {
	const EVENING = [
		'17:00',
		'17:30',
		'18:00',
		'18:30',
		'19:00',
		'19:30',
		'20:00',
		'20:30',
		'21:00',
		'21:30',
		'22:00',
		'22:30',
		'23:00'
	];

	it('offers the whole evening on a future day', () => {
		expect(timeSlots('2026-10-02', NOW, TZ, null)).toEqual(EVENING);
	});

	it('adds the group’s usual time when it is not already there, in order', () => {
		const slots = timeSlots('2026-10-02', NOW, TZ, '19:45');
		expect(slots).toContain('19:45');
		expect(slots.indexOf('19:45')).toBe(slots.indexOf('19:30') + 1);
	});

	it('drops the times that have already passed today', () => {
		// 19:10 in Berlin: 19:00 is gone, 19:30 is still ahead.
		const slots = timeSlots('2026-10-01', new Date('2026-10-01T17:10:00Z'), TZ, null);
		expect(slots[0]).toBe('19:30');
		expect(slots).not.toContain('19:00');
	});

	it('drops a slot at the very minute it starts', () => {
		const slots = timeSlots('2026-10-01', new Date('2026-10-01T17:30:00Z'), TZ, null);
		expect(slots[0]).toBe('20:00');
	});

	it('has nothing left late at night, and nothing for a past day', () => {
		expect(timeSlots('2026-10-01', new Date('2026-10-01T21:30:00Z'), TZ, null)).toEqual([]);
		expect(timeSlots('2026-09-30', NOW, TZ, null)).toEqual([]);
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

describe('pickWhen', () => {
	it('combines the chosen day and time', () => {
		expect(pickWhen({ day: '2026-10-02', time: '20:00', otherTime: '' })).toBe('2026-10-02T20:00');
	});

	it('lets the other time win over the slots', () => {
		expect(pickWhen({ day: '2026-10-02', time: '20:00', otherTime: '19:45' })).toBe(
			'2026-10-02T19:45'
		);
	});

	it('returns something wallTimeToUtc will refuse when a part is missing', () => {
		expect(pickWhen({ day: '', time: '20:00', otherTime: '' })).toBe('T20:00');
	});
});
