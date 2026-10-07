import { db } from '$lib/server/db';
import { requireMember, requireUser } from '$lib/server/groups';
import { nightIcs } from '$lib/server/ics';
import { nightMailInfo } from '$lib/server/night-mail';
import { getTimezone } from '$lib/server/settings';
import { wallParts } from '$lib/time';
import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

/** "Add to calendar": the same event the invite email carries, for download. */
export const GET: RequestHandler = ({ locals, params, url }) => {
	const user = requireUser(locals);
	requireMember(db, user.id, params.groupId);
	const info = nightMailInfo(db, params.nightId);
	// Another group's night through this URL is "not found", as on the night page.
	if (!info || info.groupId !== params.groupId || info.status === 'cancelled') {
		error(404, 'Not found');
	}
	const body = nightIcs({
		nightId: params.nightId,
		method: 'PUBLISH',
		groupName: info.groupName,
		start: info.scheduledAt,
		end: info.endsAt,
		location: info.location,
		url: `${url.origin}/groups/${params.groupId}/nights/${params.nightId}`
	});
	const day = wallParts(info.scheduledAt, getTimezone(db)).date;
	return new Response(body, {
		headers: {
			'content-type': 'text/calendar; charset=utf-8',
			'content-disposition': `attachment; filename="filmnacht-${day}.ics"`
		}
	});
};
