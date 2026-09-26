import type { Locale } from '$lib/i18n';
import { wallParts, wallTimeToUtc } from '$lib/time';

/**
 * The schedule form: a month calendar and time slots that follow the chosen
 * day. Shared by the server (first render, defaults) and the browser (month
 * switching, dropping times that have passed) so both apply the same rules.
 * Everything is the instance's wall clock (PRD §6, §12), never the device's.
 */

const EVENING_FROM = 17 * 60;
const EVENING_TO = 23 * 60;
const STEP = 30;
const DEFAULT_TIME = '20:00';

export type CalendarDay = { date: string; day: number; past: boolean; today: boolean };

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

export function shiftMonth(month: string, delta: number): string {
	const [y, m] = month.split('-').map(Number);
	return iso(new Date(Date.UTC(y, m - 1 + delta, 1))).slice(0, 7);
}

/** Monday-first weeks of the month; days outside it are null. */
export function monthGrid(month: string, today: string): Array<Array<CalendarDay | null>> {
	const first = `${month}-01`;
	const offset = (utcDate(first).getUTCDay() + 6) % 7; // Monday = 0
	const days: Array<CalendarDay | null> = Array(offset).fill(null);
	for (let date = first; date.startsWith(month); date = addDays(date, 1)) {
		days.push({ date, day: Number(date.slice(8)), past: date < today, today: date === today });
	}
	while (days.length % 7) days.push(null);
	return Array.from({ length: days.length / 7 }, (_, i) => days.slice(i * 7, i * 7 + 7));
}

export function monthTitle(month: string, locale: Locale): string {
	return new Intl.DateTimeFormat(locale === 'de' ? 'de-DE' : 'en-GB', {
		timeZone: 'UTC',
		month: 'long',
		year: 'numeric'
	}).format(utcDate(`${month}-01`));
}

export function weekdayNames(locale: Locale): string[] {
	const fmt = new Intl.DateTimeFormat(locale === 'de' ? 'de-DE' : 'en-GB', {
		timeZone: 'UTC',
		weekday: 'short'
	});
	// 5 October 2026 is a Monday.
	return Array.from({ length: 7 }, (_, i) =>
		fmt.format(new Date(Date.UTC(2026, 9, 5 + i))).replace('.', '')
	);
}

const hhmm = (minutes: number) =>
	`${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;

/**
 * The evening in half hours, plus the group's usual time if it is not one of
 * them. On today only the times still ahead remain; a past day has none.
 */
export function timeSlots(
	day: string,
	now: Date,
	timeZone: string,
	usual: string | null
): string[] {
	const slots: string[] = [];
	for (let m = EVENING_FROM; m <= EVENING_TO; m += STEP) slots.push(hhmm(m));
	if (usual && !slots.includes(usual)) slots.push(usual);
	slots.sort();

	const wall = wallParts(now, timeZone);
	if (day < wall.date) return [];
	return day === wall.date ? slots.filter((time) => time > wall.time) : slots;
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
 * The calendar posts `day` and the slots post `time`; the "other time" field,
 * when filled, wins over the slot. The result is a wall-clock string for
 * wallTimeToUtc, which refuses anything incomplete.
 */
export function pickWhen(fields: { day: string; time: string; otherTime: string }): string {
	return `${fields.day}T${fields.otherTime || fields.time}`;
}

/** "Friday 2 October 2026": the accessible name of a calendar day. */
export function dayLabel(date: string, locale: Locale): string {
	return new Intl.DateTimeFormat(locale === 'de' ? 'de-DE' : 'en-GB', {
		timeZone: 'UTC',
		weekday: 'long',
		day: 'numeric',
		month: 'long',
		year: 'numeric'
	}).format(utcDate(date));
}
