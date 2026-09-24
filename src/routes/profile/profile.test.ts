import { isHttpError } from '@sveltejs/kit';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mocked before the SUT import so `+page.server.ts`'s `import { db } from
// '$lib/server/db'` resolves to an in-memory database instead of ever
// touching the real singleton (which would create data/filmnacht.db as a
// side effect of running the test suite). Pattern from login.test.ts.
vi.mock('$lib/server/db', async () => {
	const { createDb, applyMigrations } = await import('../../lib/server/db/client');
	const { db } = createDb(':memory:');
	applyMigrations(db);
	return { db };
});

const { db } = await import('$lib/server/db');
const { hashPassword, verifyPassword } = await import('$lib/server/auth/password');
const { createSession, deleteOtherSessions, SESSION_COOKIE, validateSession } =
	await import('$lib/server/auth/session');
const { hashToken } = await import('$lib/server/auth/tokens');
const { resetRateLimits } = await import('$lib/server/rate-limit');
const { createUser, setEmail, setPassword, storedPasswordHash, userProfile } =
	await import('$lib/server/users');
const { actions, load } = await import('./+page.server');

const PASSWORD = 'correct horse battery';
const NEW_PASSWORD = 'a brand new passphrase';

// Hashed once, at module scope: scrypt is deliberately ~100ms.
const ORIGINAL_HASH = await hashPassword(PASSWORD);

const ada = createUser(db, { username: 'ada', displayName: 'Ada', passwordHash: ORIGINAL_HASH });
const grace = createUser(db, {
	username: 'grace',
	displayName: 'Grace',
	passwordHash: 'scrypt$placeholder$placeholder'
});

function cookieSpy(sessionToken?: string) {
	return {
		set: vi.fn(),
		delete: vi.fn(),
		get: vi.fn((name: string) => (name === SESSION_COOKIE ? sessionToken : undefined))
	};
}

function formRequest(fields: Record<string, string>) {
	const form = new FormData();
	for (const [k, v] of Object.entries(fields)) form.append(k, v);
	return new Request('http://localhost/profile', { method: 'POST', body: form });
}

type Caller = { id: string; displayName: string; isAdmin: boolean } | null;

async function post(
	action: 'changePassword' | 'changeDisplayName' | 'setEmail' | 'reveal',
	fields: Record<string, string> = {},
	user: Caller = ada,
	cookies = cookieSpy()
) {
	return actions[action]({
		request: formRequest(fields),
		cookies,
		locals: { user, locale: 'en' },
		url: new URL('http://localhost/profile')
	} as never);
}

/** requireUser throws a 401 HttpError rather than returning a fail(). */
async function statusOfThrow(run: () => Promise<unknown>) {
	try {
		await run();
	} catch (err) {
		if (isHttpError(err)) return err.status;
		throw err;
	}
	throw new Error('expected the action to throw, but it returned normally');
}

beforeEach(() => {
	resetRateLimits();
	setPassword(db, ada.id, ORIGINAL_HASH);
	setEmail(db, ada.id, null);
	setEmail(db, grace.id, null);
});

describe('GET /profile', () => {
	it('shows the username, display name and email', () => {
		setEmail(db, ada.id, 'ada@example.com');
		const data = load({ locals: { user: ada, locale: 'en' } } as never) as Record<string, unknown>;
		expect(data).toMatchObject({ username: 'ada', displayName: 'Ada', email: 'ada@example.com' });
	});

	it('never sends the password hash to the browser', () => {
		// This return value is serialised into the page. A hash here is a hash in
		// every visitor's HTML source, ready for an offline attack.
		const data = load({ locals: { user: ada, locale: 'en' } } as never) as Record<string, unknown>;
		expect(Object.keys(data).sort()).toEqual(['displayName', 'email', 'username']);
	});

	it('refuses a signed-out visitor', async () => {
		expect(await statusOfThrow(async () => load({ locals: { user: null } } as never))).toBe(401);
	});
});

describe('changePassword', () => {
	it('changes the password when the current one is given', async () => {
		// Without this the whole file passes against an action whose entire body
		// is `return fail(400, ...)`. Assert the feature WORKS, not only that it
		// refuses.
		const result = await post('changePassword', {
			currentPassword: PASSWORD,
			newPassword: NEW_PASSWORD,
			passwordRepeat: NEW_PASSWORD
		});
		expect(result).toEqual({ success: 'profile.password_changed' });
		expect(await verifyPassword(NEW_PASSWORD, storedPasswordHash(db, ada.id))).toBe(true);
		expect(await verifyPassword(PASSWORD, storedPasswordHash(db, ada.id))).toBe(false);
	});

	it('refuses a wrong current password and leaves the stored one alone', async () => {
		// The security property this action exists for: a session cookie proves
		// someone is at the keyboard, not that they own the account. Without this
		// check, a borrowed laptop is a permanent takeover.
		const result = await post('changePassword', {
			currentPassword: 'not her password',
			newPassword: NEW_PASSWORD,
			passwordRepeat: NEW_PASSWORD
		});
		expect(result?.status).toBe(400);
		expect(result?.data?.error).toBe('profile.error.current_password');
		expect(storedPasswordHash(db, ada.id)).toBe(ORIGINAL_HASH);
	});

	it('refuses an empty current password, which an unauthenticated form would send', async () => {
		const result = await post('changePassword', {
			newPassword: NEW_PASSWORD,
			passwordRepeat: NEW_PASSWORD
		});
		expect(result?.data?.error).toBe('profile.error.current_password');
		expect(storedPasswordHash(db, ada.id)).toBe(ORIGINAL_HASH);
	});

	it('refuses a new password below the minimum', async () => {
		const result = await post('changePassword', {
			currentPassword: PASSWORD,
			newPassword: 'short',
			passwordRepeat: 'short'
		});
		expect(result?.data?.error).toBe('auth.error.password');
		expect(storedPasswordHash(db, ada.id)).toBe(ORIGINAL_HASH);
	});

	it('refuses a repeat that does not match', async () => {
		const result = await post('changePassword', {
			currentPassword: PASSWORD,
			newPassword: NEW_PASSWORD,
			passwordRepeat: `${NEW_PASSWORD} typo`
		});
		expect(result?.data?.error).toBe('auth.error.password_mismatch');
		expect(storedPasswordHash(db, ada.id)).toBe(ORIGINAL_HASH);
	});

	it('signs out every other session and keeps this one', async () => {
		// The other half of "I think someone else has access". Rotating the
		// credential while leaving the sessions it granted alive and
		// self-renewing is not a password change, it is a password change
		// notification.
		const mine = createSession(db, ada.id);
		const theirs = createSession(db, ada.id);
		const untouched = createSession(db, grace.id);

		const result = await post(
			'changePassword',
			{ currentPassword: PASSWORD, newPassword: NEW_PASSWORD, passwordRepeat: NEW_PASSWORD },
			ada,
			cookieSpy(mine.token)
		);

		expect(result).toEqual({ success: 'profile.password_changed' });
		expect(validateSession(db, mine.token)?.user.id).toBe(ada.id);
		expect(validateSession(db, theirs.token)).toBeNull();
		// Another member's sessions are not collateral.
		expect(validateSession(db, untouched.token)?.user.id).toBe(grace.id);
		deleteOtherSessions(db, grace.id, null);
	});

	it('rate-limits guesses at the current password, keyed on the user id', async () => {
		// The only barrier between a borrowed session and a permanent takeover.
		// An ungated form lets it be guessed at whatever rate the CPU allows.
		for (let i = 0; i < 5; i++) {
			const refused = await post('changePassword', {
				currentPassword: `guess ${i}`,
				newPassword: NEW_PASSWORD,
				passwordRepeat: NEW_PASSWORD
			});
			expect(refused?.data?.error).toBe('profile.error.current_password');
		}
		const limited = await post('changePassword', {
			currentPassword: PASSWORD,
			newPassword: NEW_PASSWORD,
			passwordRepeat: NEW_PASSWORD
		});
		expect(limited?.status).toBe(429);
		expect(limited?.data?.error).toBe('profile.rate_limited');
		// Refused BEFORE the work, so even the correct password does not go
		// through — which is what makes this a gate rather than a log line.
		expect(storedPasswordHash(db, ada.id)).toBe(ORIGINAL_HASH);
	});

	it('does not let one account exhaust another account budget', async () => {
		for (let i = 0; i < 6; i++) {
			await post('changePassword', { currentPassword: `guess ${i}` });
		}
		const other = await post('changePassword', { currentPassword: 'wrong' }, grace);
		expect(other?.data?.error).toBe('profile.error.current_password');
	});

	it('refuses a signed-out visitor', async () => {
		expect(
			await statusOfThrow(() => post('changePassword', { currentPassword: PASSWORD }, null))
		).toBe(401);
	});
});

describe('changeDisplayName', () => {
	it('updates the name the group sees', async () => {
		const result = await post('changeDisplayName', { displayName: 'Ada L.' });
		expect(result).toEqual({ success: 'profile.display_name_saved' });
		expect(userProfile(db, ada.id)?.displayName).toBe('Ada L.');
		await post('changeDisplayName', { displayName: 'Ada' });
	});

	it('allows a name another member already uses', async () => {
		// Decision 20: two friends may both be "Alex" to the group. A uniqueness
		// check here would quietly undo the reason usernames exist at all.
		const result = await post('changeDisplayName', { displayName: 'Grace' });
		expect(result).toEqual({ success: 'profile.display_name_saved' });
		await post('changeDisplayName', { displayName: 'Ada' });
	});

	it('rejects an empty or over-long name', async () => {
		expect((await post('changeDisplayName', { displayName: '  ' }))?.data?.error).toBe(
			'invite.error.name'
		);
		expect((await post('changeDisplayName', { displayName: 'a'.repeat(61) }))?.data?.error).toBe(
			'invite.error.name'
		);
		expect(userProfile(db, ada.id)?.displayName).toBe('Ada');
	});

	it('refuses a signed-out visitor', async () => {
		expect(
			await statusOfThrow(() => post('changeDisplayName', { displayName: 'Mallory' }, null))
		).toBe(401);
	});
});

describe('setEmail', () => {
	it('stores an address, lowercased', async () => {
		const result = await post('setEmail', { email: 'Ada@Example.COM' });
		expect(result).toEqual({ success: 'profile.email_saved' });
		expect(userProfile(db, ada.id)?.email).toBe('ada@example.com');
	});

	it('treats an empty value as clearing it', async () => {
		await post('setEmail', { email: 'ada@example.com' });
		const result = await post('setEmail', { email: '' });
		expect(result).toEqual({ success: 'profile.email_saved' });
		expect(userProfile(db, ada.id)?.email).toBeNull();
	});

	it('rejects something that is not an address', async () => {
		const result = await post('setEmail', { email: 'ada at example dot com' });
		expect(result?.status).toBe(400);
		expect(result?.data?.error).toBe('profile.error.email');
		expect(userProfile(db, ada.id)?.email).toBeNull();
	});

	it('refuses an address another account holds, in any case', async () => {
		// Plan 4 sends a reset link to exactly one account. Two accounts sharing
		// an address has no safe answer, so the collision is refused here with a
		// translated message rather than surfacing as a 500.
		setEmail(db, grace.id, 'shared@example.com');
		const result = await post('setEmail', { email: 'SHARED@example.com' });
		expect(result?.status).toBe(400);
		expect(result?.data?.error).toBe('profile.error.email_taken');
		expect(userProfile(db, ada.id)?.email).toBeNull();
	});

	it('refuses a signed-out visitor', async () => {
		expect(await statusOfThrow(() => post('setEmail', { email: 'x@y.z' }, null))).toBe(401);
	});
});

describe('reveal', () => {
	it('still mints a link and signs out every other session', async () => {
		// Unchanged by this task, and pinned so it stays that way.
		const mine = createSession(db, ada.id);
		const theirs = createSession(db, ada.id);
		const cookies = cookieSpy(mine.token);
		const result = (await post('reveal', {}, ada, cookies)) as { loginUrl: string };

		expect(result.loginUrl).toMatch(/^http:\/\/localhost\/login\//);
		expect(validateSession(db, mine.token)?.user.id).toBe(ada.id);
		expect(validateSession(db, theirs.token)).toBeNull();
		expect(hashToken(mine.token)).toBeTruthy();
	});
});
