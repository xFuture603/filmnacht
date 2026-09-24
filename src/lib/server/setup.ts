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
export function claimInstance(
	db: DB,
	input: { username: string; displayName: string; passwordHash: string; timezone: string }
): SessionUser | null {
	return db.transaction(() => {
		if (isSetupComplete(db)) return null;
		const admin = createUser(db, {
			username: input.username,
			displayName: input.displayName,
			passwordHash: input.passwordHash,
			isAdmin: true
		});
		setSetting(db, 'timezone', input.timezone);
		setSetting(db, 'setup_complete', '1');
		return admin;
	});
}

/**
 * Where a request must be sent before it reaches a page, or null to let it
 * through. Extracted from the hook so the interaction between the two rules is
 * testable: merging them into one condition silently kills the language
 * switcher after setup, which is a bug this project has already shipped once.
 */
export function guardRedirect(pathname: string, setupComplete: boolean): string | null {
	const setupPath = pathname.startsWith('/setup');
	const localeRoute = pathname === '/locale';
	if (!setupComplete && !setupPath && !localeRoute) return '/setup';
	if (setupComplete && setupPath) return '/';
	return null;
}
