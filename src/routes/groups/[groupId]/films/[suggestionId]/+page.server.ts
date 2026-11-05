import { db } from '$lib/server/db';
import { filmDetails } from '$lib/server/film-details';
import { requireMember, requireUser } from '$lib/server/groups';
import { pooledFilm } from '$lib/server/pool';
import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, params }) => {
	const user = requireUser(locals);
	const group = requireMember(db, user.id, params.groupId);
	const film = pooledFilm(
		db,
		params.groupId,
		user.id,
		params.suggestionId,
		group.settings.resultVisible
	);
	// A member may know this film was here; +error.svelte tells them apart from
	// someone outside the group, who gets the invitation page.
	if (!film) error(404, 'gone');
	return {
		group,
		film,
		// Hand-entered films have nothing to look up.
		details: film.tmdbId ? await filmDetails(film.tmdbId, locals.locale) : null,
		tmdbUrl: film.tmdbId ? `https://www.themoviedb.org/movie/${film.tmdbId}` : null
	};
};
