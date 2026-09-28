import { DEFAULT_GROUP_SETTINGS, type GroupSettings } from './db/schema';

/** The only values the settings page offers. Anything else in a row is ignored. */
export const SETTING_CHOICES = {
	autoDrawHoursBefore: [2, 6, 12, 24, 48],
	maxOpenSuggestions: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
	nightEndsAfterMinutes: [120, 180, 240],
	ratingWindowDays: [3, 7, 14]
} as const;

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
	return {
		maxOpenSuggestions: pick(
			r.maxOpenSuggestions,
			SETTING_CHOICES.maxOpenSuggestions,
			d.maxOpenSuggestions
		),
		drawMode: pick(r.drawMode, ['fairness', 'uniform'] as const, d.drawMode),
		resultVisible: pick(r.resultVisible, ['immediately', 'on_night'] as const, d.resultVisible),
		nightEndsAfterMinutes: pick(
			r.nightEndsAfterMinutes,
			SETTING_CHOICES.nightEndsAfterMinutes,
			d.nightEndsAfterMinutes
		),
		ratingWindowDays: pick(
			r.ratingWindowDays,
			SETTING_CHOICES.ratingWindowDays,
			d.ratingWindowDays
		),
		autoDraw: typeof r.autoDraw === 'boolean' ? r.autoDraw : d.autoDraw,
		autoDrawHoursBefore: pick(
			r.autoDrawHoursBefore,
			SETTING_CHOICES.autoDrawHoursBefore,
			d.autoDrawHoursBefore
		)
	};
}
