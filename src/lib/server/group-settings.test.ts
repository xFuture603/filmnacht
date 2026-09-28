import { describe, expect, it } from 'vitest';
import { DEFAULT_GROUP_SETTINGS } from '$lib/server/db/schema';
import { groupSettings } from './group-settings';

describe('groupSettings', () => {
	it('reads an old row without the new keys as automatic draw off, 24 hours', () => {
		const old = {
			maxOpenSuggestions: 3,
			drawMode: 'fairness',
			resultVisible: 'immediately',
			nightEndsAfterMinutes: 180,
			ratingWindowDays: 7
		};
		expect(groupSettings(old)).toEqual({ ...old, autoDraw: false, autoDrawHoursBefore: 24 });
	});

	it('keeps valid values and replaces invalid ones with the defaults', () => {
		expect(
			groupSettings({
				autoDraw: true,
				autoDrawHoursBefore: 6,
				maxOpenSuggestions: 99,
				drawMode: 'chaos',
				resultVisible: 'on_night',
				nightEndsAfterMinutes: 1,
				ratingWindowDays: 14
			})
		).toEqual({
			...DEFAULT_GROUP_SETTINGS,
			autoDraw: true,
			autoDrawHoursBefore: 6,
			resultVisible: 'on_night',
			ratingWindowDays: 14
		});
	});

	it('survives garbage', () => {
		for (const bad of [null, undefined, 'x', 42, []]) {
			expect(groupSettings(bad)).toEqual(DEFAULT_GROUP_SETTINGS);
		}
	});
});
