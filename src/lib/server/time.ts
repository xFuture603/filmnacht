import type { Locale } from '$lib/i18n';

/**
 * Times are stored in UTC and shown in the ONE instance timezone (PRD §6, §12),
 * never the server's and never the browser's. Both directions live here so the
 * rule has one home.
 */

/** Offset of `timeZone` from UTC at `instant`, in ms (positive east of Greenwich). */
function offsetAt(instant: number, timeZone: string): number {
	const parts = Object.fromEntries(
		new Intl.DateTimeFormat('en-US', {
			timeZone,
			hourCycle: 'h23',
			year: 'numeric',
			month: '2-digit',
			day: '2-digit',
			hour: '2-digit',
			minute: '2-digit',
			second: '2-digit'
		})
			.formatToParts(instant)
			.map((p) => [p.type, p.value])
	);
	const asUtc = Date.UTC(
		Number(parts.year),
		Number(parts.month) - 1,
		Number(parts.day),
		Number(parts.hour),
		Number(parts.minute),
		Number(parts.second)
	);
	return asUtc - Math.floor(instant / 1000) * 1000;
}

/**
 * A `<input type="datetime-local">` value ("2026-07-01T20:00") is a wall-clock
 * time with no zone. Read it in `timeZone` and return the instant, or null when
 * it is not a real time. The second pass settles a date whose offset differs
 * from the offset at the naive guess, which is what happens on a DST switch day.
 */
export function wallTimeToUtc(wall: string, timeZone: string): Date | null {
	const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(wall);
	if (!m) return null;
	const [year, month, day, hour, minute] = m.slice(1).map(Number);
	if (hour > 23 || minute > 59) return null;
	const guess = Date.UTC(year, month - 1, day, hour, minute);
	const check = new Date(guess);
	// Date.UTC rolls 30 February over into March; a real date survives the trip.
	if (check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) return null;

	const first = guess - offsetAt(guess, timeZone);
	return new Date(guess - offsetAt(first, timeZone));
}

export function formatWhen(at: Date, timeZone: string, locale: Locale): string {
	return new Intl.DateTimeFormat(locale === 'de' ? 'de-DE' : 'en-GB', {
		timeZone,
		dateStyle: 'full',
		timeStyle: 'short'
	}).format(at);
}
