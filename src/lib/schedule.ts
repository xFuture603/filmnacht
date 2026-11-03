import { wallParts, wallTimeToUtc } from '$lib/time';

/**
 * The schedule form's suggestions. Everything is the instance's wall clock,
 * never the device's.
 */

const DEFAULT_TIME = '20:00';

/** "YYYY-MM-DD" → UTC midnight, for calendar arithmetic free of timezones and DST. */
function utcDate(date: string): Date {
	const [y, m, d] = date.split('-').map(Number);
	return new Date(Date.UTC(y, m - 1, d));
}

function iso(date: Date): string {
	return date.toISOString().slice(0, 10);
}

function addDays(date: string, days: number): string {
	const d = utcDate(date);
	d.setUTCDate(d.getUTCDate() + days);
	return iso(d);
}

/** The instance's calendar date right now. */
export function todayIn(now: Date, timeZone: string): string {
	return wallParts(now, timeZone).date;
}

/**
 * Groups meet on the same weekday at the same time, so the last night is the
 * best guess for the next: the next date on that weekday whose time is still
 * ahead, at that time and place. A group that has never met gets 20:00 and no
 * day, so the owner has to choose one.
 */
export function scheduleDefaults(
	last: { scheduledAt: Date; location: string | null } | null,
	timeZone: string,
	now: Date
): { day: string | null; time: string; location: string } {
	if (!last) return { day: null, time: DEFAULT_TIME, location: '' };
	const usual = wallParts(last.scheduledAt, timeZone);
	const weekday = utcDate(usual.date).getUTCDay();
	const today = todayIn(now, timeZone);
	let day: string | null = null;
	for (let i = 0; i <= 7 && day === null; i++) {
		const candidate = addDays(today, i);
		if (utcDate(candidate).getUTCDay() !== weekday) continue;
		const at = wallTimeToUtc(`${candidate}T${usual.time}`, timeZone);
		if (at && at.getTime() > now.getTime()) day = candidate;
	}
	return { day, time: usual.time, location: last.location ?? '' };
}

/**
 * A typed time as "HH:MM", or null. Takes "19:45", "19.45", "1945" and "7:45";
 * the 24-hour clock only, so "25:00" and "7:45 pm" are refused.
 */
export function parseTime(typed: string): string | null {
	const m = /^([01]?\d|2[0-3])[:.]?([0-5]\d)$/.exec(typed.trim());
	return m ? `${m[1].padStart(2, '0')}:${m[2]}` : null;
}
