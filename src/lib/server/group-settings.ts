import { DEFAULT_GROUP_SETTINGS, type GroupSettings } from './db/schema';

/**
 * The whole numbers the settings page takes, in the units it shows them in:
 * the night's length is typed in hours and kept in minutes. Anything else in
 * a row is ignored.
 */
export const SETTING_RANGES = {
	autoDrawHoursBefore: { min: 1, max: 72 },
	maxOpenSuggestions: { min: 1, max: 10 },
	nightEndsAfterHours: { min: 1, max: 8 },
	ratingWindowDays: { min: 1, max: 30 }
} as const;

export function inRange(value: unknown, { min, max }: { min: number; max: number }): boolean {
	return Number.isInteger(value) && (value as number) >= min && (value as number) <= max;
}

/**
 * Settings are JSON, so a row written before a key existed, or edited by hand,
 * can hold anything. Every reader goes through here: known valid values win,
 * everything else falls back to the default. An old group therefore reads as
 * "automatic draw off", never as a crash.
 */
export function groupSettings(raw: unknown): GroupSettings {
	const r = (raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}) as Record<
		string,
		unknown
	>;
	const pick = <T>(value: unknown, allowed: readonly T[], fallback: T): T =>
		allowed.includes(value as T) ? (value as T) : fallback;
	const d = DEFAULT_GROUP_SETTINGS;
	const R = SETTING_RANGES;
	return {
		maxOpenSuggestions: inRange(r.maxOpenSuggestions, R.maxOpenSuggestions)
			? (r.maxOpenSuggestions as number)
			: d.maxOpenSuggestions,
		drawMode: pick(r.drawMode, ['fairness', 'uniform'] as const, d.drawMode),
		resultVisible: pick(r.resultVisible, ['immediately', 'on_night'] as const, d.resultVisible),
		nightEndsAfterMinutes:
			typeof r.nightEndsAfterMinutes === 'number' &&
			inRange(r.nightEndsAfterMinutes / 60, R.nightEndsAfterHours)
				? (r.nightEndsAfterMinutes as number)
				: d.nightEndsAfterMinutes,
		ratingWindowDays: inRange(r.ratingWindowDays, R.ratingWindowDays)
			? (r.ratingWindowDays as number)
			: d.ratingWindowDays,
		autoDraw: typeof r.autoDraw === 'boolean' ? r.autoDraw : d.autoDraw,
		autoDrawHoursBefore: inRange(r.autoDrawHoursBefore, R.autoDrawHoursBefore)
			? (r.autoDrawHoursBefore as number)
			: d.autoDrawHoursBefore
	};
}
