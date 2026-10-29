import { env } from '$env/dynamic/private';
import { db } from '$lib/server/db';
import { requireMember, requireUser } from '$lib/server/groups';
import { searchMovies } from '$lib/server/tmdb';
import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

/** Search as you type: the add page asks here while the title is typed. */
export const GET: RequestHandler = async ({ url, locals, params }) => {
	const user = requireUser(locals);
	// Checked before any outbound call: a non-member must not be able to make
	// this instance call TMDB on their behalf.
	requireMember(db, user.id, params.groupId);
	const key = env.TMDB_API_KEY;
	if (!key) error(503, 'add.search_disabled');

	const query = (url.searchParams.get('q') ?? '').trim();
	if (query.length < 2) return json({ results: [] });
	try {
		return json({ results: await searchMovies(key, query) });
	} catch {
		error(502, 'add.search_failed');
	}
};
