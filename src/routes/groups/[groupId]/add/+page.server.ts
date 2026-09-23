import { db } from '$lib/server/db';
import { requireMember, requireUser } from '$lib/server/groups';
import { addSuggestion, NOTE_MAX } from '$lib/server/suggestions';
import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = ({ locals, params }) => {
	const user = requireUser(locals);
	const group = requireMember(db, user.id, params.groupId);
	return { group, noteMax: NOTE_MAX };
};

export const actions: Actions = {
	manual: async ({ request, locals, params }) => {
		const user = requireUser(locals);
		const group = requireMember(db, user.id, params.groupId);

		const form = await request.formData();
		// Everything below this line is synchronous, so the cap check inside
		// addSuggestion cannot be raced by a second tab.
		const rawYear = String(form.get('year') ?? '').trim();
		const year = /^\d{4}$/.test(rawYear) ? Number(rawYear) : null;
		const posterUrl = String(form.get('posterUrl') ?? '').trim() || null;

		const result = addSuggestion(db, {
			groupId: params.groupId,
			userId: user.id,
			movie: { title: String(form.get('title') ?? ''), year, posterUrl },
			note: String(form.get('note') ?? ''),
			settings: group.settings
		});
		if (!result.ok) return fail(400, { error: `pool.error.${result.reason}` });
		redirect(303, `/groups/${params.groupId}`);
	}
};
