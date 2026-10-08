import { t } from '$lib/i18n';
import { db } from '$lib/server/db';
import { notifyDraw } from '$lib/server/draw-mail';
import { notifyNightCancelled } from '$lib/server/night-mail';
import { requireMember, requireOwner, requireUser } from '$lib/server/groups';
import {
	candidatesFor,
	cancelNight,
	drawForNight,
	isResultVisible,
	markWatched,
	nightDetail,
	redraw,
	respond,
	type DrawOutcome
} from '$lib/server/nights';
import { parseScore, ratingView, revealNow, saveRating, withdrawRating } from '$lib/server/ratings';
import { getTimezone } from '$lib/server/settings';
import { formatWhen } from '$lib/time';
import { error, fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';

const RESPONSES = ['yes', 'no', 'maybe'] as const;

/**
 * The night, as seen through THIS group's URL. A night that does not exist, one
 * in a group the viewer is not in, and one belonging to a different group than
 * the URL names all get the same 404 — nightDetail already collapses the first
 * two, and the groupId comparison closes the third.
 */
function nightIn(groupId: string, nightId: string, viewerId: string) {
	const night = nightDetail(db, nightId, viewerId);
	if (!night || night.groupId !== groupId) error(404, 'Not found');
	return night;
}

/** Owner of the URL's group, and the night is in it — in that order (auth first). */
function ownerOf(locals: App.Locals, params: { groupId: string; nightId: string }) {
	const user = requireUser(locals);
	requireOwner(db, user.id, params.groupId);
	nightIn(params.groupId, params.nightId, user.id);
	return user;
}

function refused(outcome: Extract<DrawOutcome, { ok: false }>, notScheduledKey: string) {
	// Unreachable after nightIn, but if it ever happens it must look like every
	// other absent night rather than leak a distinct answer.
	if (outcome.reason === 'not_found') error(404, 'Not found');
	const key =
		outcome.reason === 'not_scheduled' ? notScheduledKey : `night.error.${outcome.reason}`;
	return fail(400, { error: key });
}

/** Cancel and Mark watched cannot be undone, so each needs its box ticked (R14). */
/**
 * Irreversible actions take two clicks. A request without `confirm` is the
 * first one: the action answers `{ confirm: <its name> }`, and the page shows
 * that button armed (ConfirmButton) so the next click sends the confirmation.
 * Works with or without JavaScript.
 */
async function confirmed(request: Request) {
	return (await request.formData()).get('confirm') === 'on';
}

export const load: PageServerLoad = ({ locals, params }) => {
	const user = requireUser(locals);
	const group = requireMember(db, user.id, params.groupId);
	const night = nightIn(params.groupId, params.nightId, user.id);

	// Withheld from the payload, not hidden in the markup: a title sitting in
	// `data` is readable in the page source, and the group was promised a surprise.
	const visible = isResultVisible(group.settings, night, new Date());
	const { drawnTitle, drawnBy, drawnByFormer, onlyCandidate, ...rest } = night;
	// A cancelled night keeps its suggestionId, but its film was released: show none.
	const hasFilm = drawnTitle !== null && (night.status === 'drawn' || night.status === 'watched');

	const now = new Date();
	const ratings = ratingView(db, params.nightId, user.id, now, t(locals.locale, 'ratings.former'));
	if (!ratings) error(404, 'Not found');
	const timezone = getTimezone(db);
	const w = ratings.window;

	return {
		group,
		isOwner: group.role === 'owner',
		night: { ...rest, when: formatWhen(night.scheduledAt, timezone, locals.locale) },
		film:
			visible && hasFilm
				? { title: drawnTitle, by: drawnBy, byFormer: drawnByFormer, onlyCandidate }
				: null,
		filmHidden: !visible && hasFilm,
		// PRD §6: Draw is disabled, with the reason, when nothing can be drawn.
		canDraw: candidatesFor(db, params.groupId).length > 0,
		ratings,
		ratingTimes: {
			opens: w.state === 'before' ? formatWhen(w.opensAt, timezone, locals.locale) : null,
			closed: w.state === 'closed' ? formatWhen(w.closedAt, timezone, locals.locale) : null
		}
	};
};

export const actions: Actions = {
	respond: async ({ request, locals, params }) => {
		const user = requireUser(locals);
		requireMember(db, user.id, params.groupId);
		nightIn(params.groupId, params.nightId, user.id);
		const response = String((await request.formData()).get('response') ?? '');
		if (!RESPONSES.includes(response as (typeof RESPONSES)[number])) {
			return fail(400, { error: 'night.error.response' });
		}
		respond(db, params.nightId, user.id, response as (typeof RESPONSES)[number]);
		return { responded: true };
	},

	draw: ({ locals, params }) => {
		const user = ownerOf(locals, params);
		const outcome = drawForNight(db, params.nightId, user.id);
		if (!outcome.ok) return refused(outcome, 'night.error.not_scheduled');
		notifyDraw(db, params.nightId);
		return { drawn: true };
	},

	redraw: async ({ request, locals, params }) => {
		const user = ownerOf(locals, params);
		// One re-draw per night, and it cannot be undone: a tick, not a reason.
		if (!(await confirmed(request))) return fail(400, { confirm: 'redraw' });
		const outcome = redraw(db, params.nightId, user.id);
		if (!outcome.ok) return refused(outcome, 'night.error.not_drawn');
		notifyDraw(db, params.nightId);
		return { drawn: true };
	},

	cancel: async ({ request, locals, params }) => {
		const user = ownerOf(locals, params);
		if (!(await confirmed(request))) return fail(400, { confirm: 'cancel' });
		// Nothing awaits after this line.
		if (!cancelNight(db, params.nightId, user.id)) {
			return fail(400, { error: 'night.error.cannot_cancel' });
		}
		notifyNightCancelled(db, params.nightId);
		return { cancelled: true };
	},

	markWatched: async ({ request, locals, params }) => {
		const user = ownerOf(locals, params);
		if (!(await confirmed(request))) return fail(400, { confirm: 'markWatched' });
		// Nothing awaits after this line.
		if (!markWatched(db, params.nightId, user.id)) {
			return fail(400, { error: 'night.error.not_drawn' });
		}
		return { watched: true };
	},

	rate: async ({ request, locals, params }) => {
		const user = requireUser(locals);
		requireMember(db, user.id, params.groupId);
		nightIn(params.groupId, params.nightId, user.id);
		const form = await request.formData();
		const scoreX2 = parseScore(form.get('score'));
		if (scoreX2 === null) return fail(400, { error: 'ratings.error.score' });
		const outcome = saveRating(db, {
			nightId: params.nightId,
			userId: user.id,
			scoreX2,
			comment: String(form.get('comment') ?? ''),
			now: new Date()
		});
		if (!outcome.ok) {
			if (outcome.reason === 'not_found') error(404, 'Not found');
			return fail(400, { error: `ratings.error.${outcome.reason}` });
		}
		return { rated: true, revealed: outcome.revealed };
	},

	withdrawRating: ({ locals, params }) => {
		const user = requireUser(locals);
		requireMember(db, user.id, params.groupId);
		nightIn(params.groupId, params.nightId, user.id);
		const outcome = withdrawRating(db, {
			nightId: params.nightId,
			userId: user.id,
			now: new Date()
		});
		if (outcome !== 'ok') return fail(400, { error: `ratings.error.${outcome}` });
		return { withdrawn: true };
	},

	reveal: async ({ request, locals, params }) => {
		const user = ownerOf(locals, params);
		if (!(await confirmed(request))) return fail(400, { confirm: 'reveal' });
		const outcome = revealNow(db, { nightId: params.nightId, ownerId: user.id, now: new Date() });
		if (outcome === 'not_found') error(404, 'Not found');
		if (outcome !== 'ok') return fail(400, { error: `ratings.error.${outcome}` });
		return { revealed: true };
	}
};
