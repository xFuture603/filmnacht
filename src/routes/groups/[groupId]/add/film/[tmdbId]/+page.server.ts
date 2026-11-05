import { db } from '$lib/server/db';
import { filmDetails, tmdbFilm } from '$lib/server/film-details';
import { groupExists, requireMember } from '$lib/server/groups';
import { previewOf } from '$lib/server/pool';
import { rateLimit } from '$lib/server/rate-limit';
import { getEmailLocale } from '$lib/server/settings';
import { countOpenSuggestions, takenTmdbIds } from '$lib/server/suggestions';
import { t } from '$lib/i18n';
import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

/** How many films a minute link previews may look up at TMDB, for all visitors together. */
const PREVIEW_LOOKUPS_PER_MINUTE = 30;

export const load: PageServerLoad = async ({ locals, params }) => {
	const tmdbId = /^[1-9]\d{0,9}$/.test(params.tmdbId) ? Number(params.tmdbId) : null;

	// Signed out: the invitation, with the film's public TMDB title and poster for
	// a chat app's link preview. This is the one place someone outside a group can
	// make this instance call TMDB, so it takes a real group's link, only ever
	// sends TMDB a film id, and is capped so nobody can use up the API key.
	if (!locals.user) {
		const film =
			tmdbId && groupExists(db, params.groupId)
				? await tmdbFilm(tmdbId, {
						mayLookUp: () => rateLimit('tmdb-preview', PREVIEW_LOOKUPS_PER_MINUTE)
					})
				: null;
		return {
			preview: film && previewOf(film),
			question: t(getEmailLocale(db), 'film.preview_question')
		};
	}

	const user = locals.user;
	// Checked before any outbound call, as on the add page.
	const group = requireMember(db, user.id, params.groupId);
	const film = tmdbId && (await tmdbFilm(tmdbId));
	if (!film) error(404, 'gone');
	return {
		group,
		film,
		details: await filmDetails(film.tmdbId, locals.locale),
		tmdbUrl: `https://www.themoviedb.org/movie/${film.tmdbId}`,
		taken: takenTmdbIds(db, params.groupId).includes(film.tmdbId),
		capped: countOpenSuggestions(db, params.groupId, user.id) >= group.settings.maxOpenSuggestions
	};
};
