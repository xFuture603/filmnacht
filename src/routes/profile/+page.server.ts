import { deleteOtherSessions, SESSION_COOKIE } from '$lib/server/auth/session';
import { hashToken } from '$lib/server/auth/tokens';
import { db } from '$lib/server/db';
import { requireUser } from '$lib/server/groups';
import { regenerateLoginToken } from '$lib/server/users';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = ({ locals }) => {
	requireUser(locals);
	return {};
};

export const actions: Actions = {
	reveal: async ({ locals, url, cookies }) => {
		const user = requireUser(locals);
		// Only the hash is stored (PRD §10), so the link cannot be shown again —
		// revealing mints a fresh one, which is also the "revoke" of PRD §9. A
		// leaked link may already have been used, so revoking must also kill every
		// session it granted — every session but this device's own.
		const token = regenerateLoginToken(db, user.id);
		const currentToken = cookies.get(SESSION_COOKIE);
		const keepSessionId = currentToken ? hashToken(currentToken) : null;
		deleteOtherSessions(db, user.id, keepSessionId);
		return { loginUrl: `${url.origin}/login/${token}` };
	}
};
