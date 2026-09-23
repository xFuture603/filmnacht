import { isRedirect } from '@sveltejs/kit';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mocked before the SUT import so `+page.server.ts`'s `import { db } from
// '$lib/server/db'` resolves to an in-memory database instead of ever
// touching the real singleton (which would create data/filmnacht.db as a
// side effect of running the test suite). Pattern from add/page.server.test.ts.
vi.mock('$lib/server/db', async () => {
	const { createDb, applyMigrations } = await import('../../../lib/server/db/client');
	const { db } = createDb(':memory:');
	applyMigrations(db);
	return { db };
});

const { db } = await import('$lib/server/db');
const { users } = await import('../../../lib/server/db/schema');
const { createGroup } = await import('../../../lib/server/groups');
const { createInvite, redeemInvite } = await import('../../../lib/server/invites');
const { createUser, userByUsername } = await import('../../../lib/server/users');
const { resetRateLimits } = await import('$lib/server/rate-limit');
const { actions } = await import('./+page.server');

const PLACEHOLDER_HASH = 'scrypt$placeholder$placeholder';

function formRequest(fields: Record<string, string>) {
	const form = new FormData();
	for (const [k, v] of Object.entries(fields)) form.append(k, v);
	return new Request('http://localhost/join/irrelevant', { method: 'POST', body: form });
}

function userCount() {
	return db.select().from(users).all().length;
}

type Caller = { id: string; displayName: string; isAdmin: boolean } | null;

async function post(
	token: string,
	fields: Record<string, string>,
	user: Caller = null,
	address = '1.2.3.4'
) {
	return actions.default({
		request: formRequest(fields),
		params: { token },
		cookies: { set: vi.fn(), get: vi.fn(), delete: vi.fn() },
		getClientAddress: () => address,
		locals: { user, locale: 'en' },
		url: new URL(`http://localhost/join/${token}`)
	} as never);
}

// redirect() throws (see @sveltejs/kit's Redirect), so a successful join must
// be awaited inside a try/catch rather than read off a return value.
async function postExpectRedirect(
	token: string,
	fields: Record<string, string>,
	user: Caller = null,
	address = '1.2.3.4'
) {
	try {
		await post(token, fields, user, address);
	} catch (err) {
		if (isRedirect(err)) return err;
		throw err;
	}
	throw new Error('expected the action to redirect, but it returned normally');
}

let ownerId: string;
let groupId: string;

// The mocked db (above) is a single shared in-memory instance for this whole
// file, not reset between tests — so the owner created here needs a fresh
// username on every run, or the second test's beforeEach collides with the
// first test's leftover row.
beforeEach(() => {
	resetRateLimits();
	const owner = `owner-${crypto.randomUUID()}`;
	ownerId = createUser(db, {
		username: owner,
		displayName: 'Owner',
		passwordHash: PLACEHOLDER_HASH
	}).id;
	groupId = createGroup(db, { name: 'Movie Club', ownerId });
});

describe('FIX 1 — no username-existence oracle without a valid invite', () => {
	it('gives an existing username and an unknown username the identical response for a token that never existed', async () => {
		createUser(db, { username: 'ada', displayName: 'Ada', passwordHash: PLACEHOLDER_HASH });

		const fields = (username: string) => ({
			username,
			displayName: 'Someone',
			password: 'a fine password here',
			passwordRepeat: 'a fine password here'
		});

		const existing = await post('this-token-never-existed', fields('ada'));
		const unknown = await post('this-token-never-existed', fields('totally-unknown-name'));

		// The oracle this closes: without FIX 1, an existing username produced
		// 400 auth.error.username_taken while an unknown one produced 410
		// invite.invalid — different status AND body, learnable with no invite
		// at all. Both must now be the single "no invite" response.
		expect(existing?.status).toBe(unknown?.status);
		expect(existing?.data).toEqual(unknown?.data);
		expect(existing?.status).toBe(410);
		expect(existing?.data).toEqual({ error: 'invite.invalid' });
	});
});

describe('a signed-in visitor joins as themselves', () => {
	it('creates no new account: createUser never adds a users row', async () => {
		const token = createInvite(db, { groupId, createdBy: ownerId });
		const friend = createUser(db, {
			username: 'friend',
			displayName: 'Friend',
			passwordHash: PLACEHOLDER_HASH
		});
		const before = userCount();

		const result = await postExpectRedirect(token, {}, { ...friend, isAdmin: false });

		expect(userCount()).toBe(before);
		expect(result.status).toBe(303);
		expect(result.location).toBe(`/groups/${groupId}`);
	});
});

describe('a signed-out visitor with a valid invite', () => {
	it('creates exactly one new account', async () => {
		const token = createInvite(db, { groupId, createdBy: ownerId });
		const before = userCount();

		const result = await postExpectRedirect(token, {
			username: 'newperson',
			displayName: 'New Person',
			password: 'a fine password here',
			passwordRepeat: 'a fine password here'
		});

		expect(userCount()).toBe(before + 1);
		expect(result.status).toBe(303);
		expect(result.location).toBe(`/groups/${groupId}`);
		expect(userByUsername(db, 'newperson')).not.toBeNull();
	});
});

describe('invalid invites are indistinguishable', () => {
	it('a token that never existed and a token already at its use cap fail identically', async () => {
		const spentToken = createInvite(db, { groupId, createdBy: ownerId, maxUses: 1 });
		const filler = createUser(db, {
			username: 'filler',
			displayName: 'Filler',
			passwordHash: PLACEHOLDER_HASH
		});
		// Spends the invite's single use before this test's own attempt.
		redeemInvite(db, spentToken, filler.id);

		const fields = {
			username: 'candidate',
			displayName: 'Candidate',
			password: 'a fine password here',
			passwordRepeat: 'a fine password here'
		};

		const unknown = await post('this-token-never-existed', fields);
		const spent = await post(spentToken, { ...fields, username: 'candidate2' });

		expect(unknown?.status).toBe(spent?.status);
		expect(unknown?.data).toEqual(spent?.data);
		expect(unknown?.status).toBe(410);
	});
});

describe('password validation', () => {
	it('rejects a mismatched password and repeat', async () => {
		const token = createInvite(db, { groupId, createdBy: ownerId });

		const result = await post(token, {
			username: 'mismatch',
			displayName: 'Mismatch',
			password: 'first password here',
			passwordRepeat: 'second password here'
		});

		expect(result?.status).toBe(400);
		expect(result?.data?.error).toBe('auth.error.password_mismatch');
		expect(userByUsername(db, 'mismatch')).toBeNull();
	});
});
