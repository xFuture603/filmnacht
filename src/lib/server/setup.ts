import type { SessionUser } from './auth/session';
import type { DB } from './db/client';
import { isSetupComplete, setSetting } from './settings';
import { createUser } from './users';

/**
 * Claims the instance for its first admin, or returns null if someone already
 * has. The test and the set must happen together: checking before
 * `await request.formData()` in a route lets two concurrent tabs both read
 * "not complete" and both mint an admin.
 *
 * Passing `db` inside the transaction rather than the transaction handle is
 * correct here, and deliberate: better-sqlite3 is a single connection, so BEGIN
 * applies to every statement issued through `db` until COMMIT. Do not "fix"
 * this by threading a `tx` handle through the helpers.
 */
export function claimInstance(db: DB, displayName: string, timezone: string): SessionUser | null {
	return db.transaction(() => {
		if (isSetupComplete(db)) return null;
		const admin = createUser(db, displayName, true);
		setSetting(db, 'timezone', timezone);
		setSetting(db, 'setup_complete', '1');
		return admin;
	});
}
