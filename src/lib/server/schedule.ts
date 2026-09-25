import type { Locale } from '$lib/i18n';
import { t } from '$lib/i18n';
import { wallParts, wallTimeToUtc } from './time';

/**
 * The schedule form offers days and times as one-tap chips instead of the
 * browser's datetime picker. Everything here is in the instance's wall clock
 * (PRD §6, §12) and pure, so the defaults can be tested without a database.
 */

const DAYS_OFFERED = 14;
const EVENING = ['18:00', '18:30', '19:00', '19:30', '20:00', '20:30', '21:00', '21:30'];
const DEFAULT_TIME = '20:00';

/** Calendar arithmetic on "YYYY-MM-DD", independent of any timezone or DST. */
function addDays(date: string, days: number): string {
	const [y, m, d] = date.split('-').map(Number);
	return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

function weekday(date: string): number {
	const [y, m, d] = date.split('-').map(Number);
	return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/**
 * "Mon 28"; the month is added only where it changes ("Thu 1 Oct", and on the
 * first dated chip), so every chip stays one short line on a phone.
 */
function dayLabel(date: string, locale: Locale, withMonth: boolean): string {
	const [y, m, d] = date.split('-').map(Number);
	const parts = Object.fromEntries(
		new Intl.DateTimeFormat(locale === 'de' ? 'de-DE' : 'en-GB', {
			timeZone: 'UTC',
			weekday: 'short',
			day: 'numeric',
			month: 'short'
		})
			.formatToParts(new Date(Date.UTC(y, m - 1, d)))
			.map((p) => [p.type, p.value])
	);
	const day = locale === 'de' ? `${parts.weekday} ${parts.day}.` : `${parts.weekday} ${parts.day}`;
	return withMonth ? `${day} ${parts.month}` : day;
}

export function dayOptions(
	now: Date,
	timeZone: string,
	locale: Locale
): Array<{ value: string; label: string }> {
	const today = wallParts(now, timeZone).date;
	return Array.from({ length: DAYS_OFFERED }, (_, i) => {
		const value = addDays(today, i);
		const label =
			i === 0
				? t(locale, 'nights.today')
				: i === 1
					? t(locale, 'nights.tomorrow')
					: dayLabel(value, locale, i === 2 || value.endsWith('-01'));
		return { value, label };
	});
}

/** The evening in half hours, plus the group's usual time if it is not one of them. */
export function timeOptions(usual: string | null): string[] {
	return usual && !EVENING.includes(usual) ? [...EVENING, usual].sort() : EVENING;
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
	const today = wallParts(now, timeZone).date;
	let day: string | null = null;
	for (let i = 0; i < DAYS_OFFERED; i++) {
		const candidate = addDays(today, i);
		if (weekday(candidate) !== weekday(usual.date)) continue;
		const at = wallTimeToUtc(`${candidate}T${usual.time}`, timeZone);
		if (at && at.getTime() > now.getTime()) {
			day = candidate;
			break;
		}
	}
	return { day, time: usual.time, location: last.location ?? '' };
}

/**
 * The chips post `day` and `time`; the "other date or time" fields, when
 * filled, win over them part by part. The result is a wall-clock string for
 * wallTimeToUtc, which refuses anything incomplete.
 */
export function pickWhen(fields: {
	day: string;
	time: string;
	otherDay: string;
	otherTime: string;
}): string {
	return `${fields.otherDay || fields.day}T${fields.otherTime || fields.time}`;
}
