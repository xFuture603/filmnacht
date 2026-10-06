import { db } from '$lib/server/db';
import { SETTING_CHOICES } from '$lib/server/group-settings';
import { deleteGroup, requireOwner, requireUser } from '$lib/server/groups';
import { groups } from '$lib/server/db/schema';
import { isMailConfigured } from '$lib/server/mail';
import { newCounts } from '$lib/server/seen';
import { fail, redirect } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = ({ locals, params }) => {
	const user = requireUser(locals);
	const group = requireOwner(db, user.id, params.groupId);
	return {
		group,
		settings: group.settings,
		choices: SETTING_CHOICES,
		mailConfigured: isMailConfigured(),
		newCounts: newCounts(db, user.id, params.groupId)
	};
};

export const actions: Actions = {
	save: async ({ request, locals, params }) => {
		const user = requireUser(locals);
		const group = requireOwner(db, user.id, params.groupId);
		const form = await request.formData();
		const checked = (name: string) => form.get(name) === 'on';
		const number = (name: keyof typeof SETTING_CHOICES) => Number(form.get(name));

		const maxOpenSuggestions = number('maxOpenSuggestions');
		const nightEndsAfterMinutes = number('nightEndsAfterMinutes');
		const ratingWindowDays = number('ratingWindowDays');
		const autoDrawHoursBefore = number('autoDrawHoursBefore');
		const numbers = {
			maxOpenSuggestions,
			nightEndsAfterMinutes,
			ratingWindowDays,
			autoDrawHoursBefore
		};
		const valid = (Object.keys(numbers) as (keyof typeof numbers)[]).every((key) =>
			(SETTING_CHOICES[key] as readonly number[]).includes(numbers[key])
		);
		if (!valid) return fail(400, { error: 'settings.error.invalid' });

		const autoDraw = checked('autoDraw');
		// Refuse only TURNING IT ON: a group that already has automatic draw on
		// must still be editable (e.g. to change something unrelated) after mail
		// breaks, or its owner is locked out of their own settings page by a
		// problem they may not even control.
		if (autoDraw && !group.settings.autoDraw && !isMailConfigured()) {
			return fail(400, { error: 'settings.error.no_mail' });
		}

		db.update(groups)
			.set({
				settings: {
					maxOpenSuggestions,
					drawMode: checked('fairDraw') ? 'fairness' : 'uniform',
					resultVisible: checked('surprise') ? 'on_night' : 'immediately',
					nightEndsAfterMinutes,
					ratingWindowDays,
					autoDraw,
					autoDrawHoursBefore
				}
			})
			.where(eq(groups.id, params.groupId))
			.run();
		return { saved: true };
	},

	deleteGroup: async ({ request, locals, params }) => {
		const user = requireUser(locals);
		const group = requireOwner(db, user.id, params.groupId);
		// Typing the name, not ticking a box: this one cannot be undone.
		const name = String((await request.formData()).get('name') ?? '').trim();
		if (name !== group.name) return fail(400, { error: 'settings.error.delete_name' });
		deleteGroup(db, params.groupId);
		redirect(303, '/groups');
	}
};
