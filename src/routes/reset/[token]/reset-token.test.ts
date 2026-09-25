import { isRedirect } from '@sveltejs/kit';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { hashPassword, verifyPassword } from '$lib/server/auth/password';
import { createSession, validateSession } from '$lib/server/auth/session';
import { hashToken } from '$lib/server/auth/tokens';
import { applyMigrations, createDb, type DB } from '$lib/server/db/client';
import { passwordResets, users } from '$lib/server/db/schema';
import { resetRateLimits } from '$lib/server/rate-limit';
import { createReset, RESET_TTL_MS } from '$lib/server/resets';
import {
	createUser,
	regenerateLoginToken,
	storedPasswordHash,
	userByLoginToken
} from '$lib/server/users';

let db: DB;
let userId: string;
let graceId: string;

// A fresh database per test, so the route's `import { db }` reads through this
// getter on every access instead of binding a module-scope singleton.
vi.mock('$lib/server/db', () => ({
	get db() {
		return db;
	}
}));

// Wraps the real hashPassword to count calls. The route hashes BEFORE it spends
// the token, deliberately, so that an invalid token costs the same ~100ms as a
// valid one and a mistyped repeat does not burn the single link the member has.
// That ordering is invisible to every other assertion in this file: moving the
// hash below consumeReset leaves them all green. This counter is what pins it,
// structurally rather than by reading a clock.
let hashCalls = 0;
vi.mock('$lib/server/auth/password', async (importOriginal) => {
	const actual = await importOriginal<typeof import('$lib/server/auth/password')>();
	return {
		...actual,
		hashPassword: (password: string) => {
			hashCalls++;
			return actual.hashPassword(password);
		}
	};
});

const { actions } = await import('./+page.server');

const cookiesSet: Array<{ name: string; value: string }> = [];
const cookies = {
	set: (name: string, value: string) => cookiesSet.push({ name, value }),
	get: () => undefined,
	delete: () => {}
};

/** Either shape this route can answer with: an ActionFailure, or a Redirect. */
type Answer = { status?: number; location?: string; data?: { error?: string } };

async function post(
	token: string,
	fields: Record<string, string>,
	address = '1.2.3.4'
): Promise<Answer> {
	try {
		return ((await actions.default({
			params: { token },
			request: new Request(`http://localhost/reset/${token}`, {
				method: 'POST',
				body: new URLSearchParams(fields)
			}),
			cookies,
			getClientAddress: () => address,
			url: new URL(`http://localhost/reset/${token}`)
		} as never)) ?? {}) as Answer;
	} catch (err) {
		// A success throws a redirect (see @sveltejs/kit's Redirect), so returning
		// it makes both outcomes assertable. Anything else is a genuine crash and
		// is rethrown rather than quietly asserted on, the convention login.test.ts
		// and join.test.ts already use.
		if (isRedirect(err)) return err as Answer;
		throw err;
	}
}

const NEW = 'a brand new password';
const OLD = 'the old password';

beforeEach(async () => {
	db = createDb(':memory:').db;
	applyMigrations(db);
	resetRateLimits();
	cookiesSet.length = 0;
	userId = createUser(db, {
		username: 'ada',
		displayName: 'Ada',
		passwordHash: await hashPassword(OLD)
	}).id;
	graceId = createUser(db, {
		username: 'grace',
		displayName: 'Grace',
		passwordHash: await hashPassword('graces own password')
	}).id;
	// Last: the two createUser calls above hash as well.
	hashCalls = 0;
});

describe('POST /reset/[token]', () => {
	it('sets the new password and signs the caller in', async () => {
		// The happy path, asserted first and deliberately: without it every
		// revocation test below passes against a route that does nothing at all.
		const token = createReset(db, userId);
		const thrown = await post(token, { password: NEW, passwordRepeat: NEW });

		expect(thrown?.status).toBe(303);
		expect(thrown?.location).toBe('/groups');
		expect(await verifyPassword(NEW, storedPasswordHash(db, userId))).toBe(true);
		expect(await verifyPassword(OLD, storedPasswordHash(db, userId))).toBe(false);

		// Signed in, not merely redirected: the cookie must carry a session that
		// resolves to this account. A revocation path that swept its own new
		// session would land the member on /groups and bounce them to /login.
		expect(cookiesSet).toHaveLength(1);
		expect(validateSession(db, cookiesSet[0].value)?.user.id).toBe(userId);
	});

	it('signs out every existing session for the account and nobody else', async () => {
		const ada = createSession(db, userId);
		const grace = createSession(db, graceId);
		const token = createReset(db, userId);

		await post(token, { password: NEW, passwordRepeat: NEW });

		expect(validateSession(db, ada.token)).toBeNull();
		// What SURVIVES, not only what died: a sweep that deleted every session on
		// the instance would pass an assertion that only checks Ada's is gone.
		expect(validateSession(db, grace.token)?.user.id).toBe(graceId);
	});

	it('kills a personal login link that was saved before the reset', async () => {
		// The Plan 3 Major finding, in this route's shape. A member resetting a
		// password they could not even remember is at least as likely to be
		// evicting someone as one who still knows it.
		const saved = regenerateLoginToken(db, userId);
		const gracesLink = regenerateLoginToken(db, graceId);
		const token = createReset(db, userId);

		await post(token, { password: NEW, passwordRepeat: NEW });

		expect(userByLoginToken(db, saved)).toBeNull();
		const row = db
			.select({ hash: users.loginTokenHash })
			.from(users)
			.where(eq(users.id, userId))
			.get();
		expect(row?.hash).not.toBe(hashToken(saved));
		// Rotated, not emptied: the column is NOT NULL and the account must still
		// have a link its owner can reveal from /profile afterwards.
		expect(row?.hash).toMatch(/^[0-9a-f]{64}$/);
		// And rotating one account's link must not touch another's.
		expect(userByLoginToken(db, gracesLink)?.id).toBe(graceId);
	});

	it('refuses a token that has already been spent', async () => {
		// Review Focus 2. A reset link sits in a mailbox indefinitely; single use
		// is the only thing that bounds how long it is dangerous.
		const token = createReset(db, userId);
		await post(token, { password: NEW, passwordRepeat: NEW });

		const again = await post(token, {
			password: 'another one entirely',
			passwordRepeat: 'another one entirely'
		});
		expect(again?.status).toBe(400);
		expect(again?.data).toEqual({ error: 'reset.invalid' });
		expect(await verifyPassword(NEW, storedPasswordHash(db, userId))).toBe(true);
	});

	it('gives an expired token and an invented one the identical answer', async () => {
		const expired = createReset(db, userId, Date.now() - RESET_TTL_MS - 1000);
		const a = await post(expired, { password: NEW, passwordRepeat: NEW });
		const b = await post('never-existed', { password: NEW, passwordRepeat: NEW });

		expect(a?.status).toBe(b?.status);
		expect(a?.data).toEqual(b?.data);
		// Pinned to the concrete shape as well as to each other: both branches
		// returning a plain object would make .data undefined on both sides and
		// the comparison above would hold against a route answering the two cases
		// in completely different words.
		expect(a?.status).toBe(400);
		expect(a?.data).toEqual({ error: 'reset.invalid' });
		// And neither spent anything: Ada still has her old password.
		expect(await verifyPassword(OLD, storedPasswordHash(db, userId))).toBe(true);
	});

	it('pays for the password hash even when the token is invalid', async () => {
		// hashPassword runs BEFORE consumeReset so that a wrong token costs the
		// same ~100ms as a right one. Reordering it for efficiency would turn this
		// route into an oracle for which reset tokens are live.
		await post('never-existed', { password: NEW, passwordRepeat: NEW });
		expect(hashCalls).toBe(1);
	});

	it('still works when the email address changed after the token was minted', async () => {
		// Review Focus 3. The token resolves to the ACCOUNT. Whoever last touched
		// the email column must not be able to block the owner's recovery.
		const token = createReset(db, userId);
		const { setEmail } = await import('$lib/server/users');
		setEmail(db, userId, 'somewhere-else@example.com');

		const thrown = await post(token, { password: NEW, passwordRepeat: NEW });
		expect(thrown?.status).toBe(303);
		expect(await verifyPassword(NEW, storedPasswordHash(db, userId))).toBe(true);
	});

	it('rejects a mismatched repeat without spending the token', async () => {
		const token = createReset(db, userId);
		const bad = await post(token, { password: NEW, passwordRepeat: 'not the same' });
		expect(bad?.data?.error).toBe('auth.error.password_mismatch');
		expect(db.select().from(passwordResets).all()[0].usedAt).toBeNull();

		const good = await post(token, { password: NEW, passwordRepeat: NEW });
		expect(good?.status).toBe(303);
	});

	it('rejects a password that is too short without spending the token', async () => {
		const token = createReset(db, userId);
		const bad = await post(token, { password: 'short', passwordRepeat: 'short' });
		expect(bad?.status).toBe(400);
		expect(bad?.data).toEqual({ error: 'auth.error.password' });

		const good = await post(token, { password: NEW, passwordRepeat: NEW });
		expect(good?.status).toBe(303);
	});

	it('rate-limits by client address before it hashes anything', async () => {
		// Unauthenticated scrypt: without a gate, anyone can spend ~100ms of this
		// instance's CPU per request with an invented token. Every other
		// unauthenticated route here gates the same way.
		for (let i = 0; i < 10; i++)
			await post('never-existed', { password: NEW, passwordRepeat: NEW });
		hashCalls = 0;

		const token = createReset(db, userId);
		const blocked = await post(token, { password: NEW, passwordRepeat: NEW });
		expect(blocked?.status).toBe(429);
		expect(blocked?.data).toEqual({ error: 'reset.rate_limited' });
		expect(hashCalls).toBe(0);
		expect(db.select().from(passwordResets).all()[0].usedAt).toBeNull();

		// Another address keeps its own budget, so one flood cannot lock the
		// instance's members out of their own recovery.
		const other = await post(token, { password: NEW, passwordRepeat: NEW }, '5.6.7.8');
		expect(other?.status).toBe(303);
	});
});
