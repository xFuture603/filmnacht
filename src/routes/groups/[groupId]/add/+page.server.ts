import { env } from '$env/dynamic/private';
import { db } from '$lib/server/db';
import { requireMember, requireUser } from '$lib/server/groups';
import { addSuggestion, NOTE_MAX } from '$lib/server/suggestions';
import { fetchMovie, searchMovies } from '$lib/server/tmdb';
import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = ({ locals, params }) => {
	const user = requireUser(locals);
	const group = requireMember(db, user.id, params.groupId);
	return { group, noteMax: NOTE_MAX, tmdbEnabled: !!env.TMDB_API_KEY };
};

export const actions: Actions = {
	manual: async ({ request, locals, params }) => {
		const user = requireUser(locals);

		const form = await request.formData();
		// The membership/settings snapshot is taken only after the last await, so
		// it cannot go stale between the check and the write below.
		const group = requireMember(db, user.id, params.groupId);
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
	},

	search: async ({ request, locals, params }) => {
		const user = requireUser(locals);
		requireMember(db, user.id, params.groupId);
		const key = env.TMDB_API_KEY;
		if (!key) return fail(400, { error: 'add.search_disabled' });

		const query = String((await request.formData()).get('query') ?? '').trim();
		if (!query) return { results: [], query };
		try {
			return { results: await searchMovies(key, query), query };
		} catch {
			// TMDB being down must never block the mandated manual path.
			return fail(502, { error: 'add.search_failed' });
		}
	},

	adopt: async ({ request, locals, params }) => {
		const user = requireUser(locals);
		const key = env.TMDB_API_KEY;
		if (!key) return fail(400, { error: 'add.search_disabled' });

		const form = await request.formData();
		const tmdbId = Number(form.get('tmdbId'));
		if (!Number.isInteger(tmdbId) || tmdbId <= 0) {
			return fail(400, { error: 'pool.error.bad_title' });
		}

		let detail;
		try {
			detail = await fetchMovie(key, tmdbId);
		} catch {
			return fail(502, { error: 'add.search_failed' });
		}
		if (!detail) return fail(404, { error: 'add.search_none' });

		// Past the last await: the membership/settings snapshot and the cap check
		// inside addSuggestion are both now unraceable.
		const group = requireMember(db, user.id, params.groupId);
		const result = addSuggestion(db, {
			groupId: params.groupId,
			userId: user.id,
			movie: detail,
			note: String(form.get('note') ?? ''),
			settings: group.settings
		});
		if (!result.ok) return fail(400, { error: `pool.error.${result.reason}` });
		redirect(303, `/groups/${params.groupId}`);
	}
};
