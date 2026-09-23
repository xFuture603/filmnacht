import { isRedirect } from '@sveltejs/kit';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mocked before the SUT import so `+page.server.ts`'s `import { db } from
// '$lib/server/db'` resolves to an in-memory database instead of ever
// touching the real singleton (which would create data/filmnacht.db as a
// side effect of running the test suite). Pattern from join.test.ts.
vi.mock('$lib/server/db', async () => {
	const { createDb, applyMigrations } = await import('../../lib/server/db/client');
	const { db } = createDb(':memory:');
	applyMigrations(db);
	return { db };
});

const { db } = await import('$lib/server/db');
const { hashPassword } = await import('$lib/server/auth/password');
const { SESSION_COOKIE } = await import('$lib/server/auth/session');
const { resetRateLimits } = await import('$lib/server/rate-limit');
const { createUser } = await import('$lib/server/users');
const { actions } = await import('./+page.server');

const PASSWORD = 'correct horse battery';

// Hashed once, at module scope: scrypt is deliberately ~100ms and every test
// in this file signs in as the same account.
createUser(db, {
	username: 'ada',
	displayName: 'Ada',
	passwordHash: await hashPassword(PASSWORD)
});

function cookieSpy() {
	return { set: vi.fn(), get: vi.fn(), delete: vi.fn() };
}

function formRequest(fields: Record<string, string>) {
	const form = new FormData();
	for (const [k, v] of Object.entries(fields)) form.append(k, v);
	return new Request('http://localhost/login', { method: 'POST', body: form });
}

async function post(fields: Record<string, string>, address = '1.2.3.4', cookies = cookieSpy()) {
	return actions.default({
		request: formRequest(fields),
		cookies,
		getClientAddress: () => address,
		url: new URL('http://localhost/login'),
		locals: { user: null, locale: 'en' }
	} as never);
}

// redirect() throws (see @sveltejs/kit's Redirect), so a successful sign-in
// has to be awaited inside a try/catch rather than read off a return value.
async function postExpectRedirect(fields: Record<string, string>, address = '1.2.3.4') {
	const cookies = cookieSpy();
	try {
		await post(fields, address, cookies);
	} catch (err) {
		if (isRedirect(err)) return { redirect: err, cookies };
		throw err;
	}
	throw new Error('expected the action to redirect, but it returned normally');
}

beforeEach(() => {
	resetRateLimits();
});

describe('POST /login', () => {
	it('signs in with the correct username and password', async () => {
		const { redirect, cookies } = await postExpectRedirect({
			username: 'ada',
			password: PASSWORD
		});

		expect(redirect.status).toBe(303);
		expect(redirect.location).toBe('/groups');
		expect(cookies.set).toHaveBeenCalledWith(
			SESSION_COOKIE,
			expect.any(String),
			expect.objectContaining({ httpOnly: true })
		);
	});

	it('rejects a wrong password', async () => {
		const result = await post({ username: 'ada', password: 'wrong password' });
		expect(result?.status).toBe(400);
		expect(result?.data?.error).toBe('login.failed');
	});

	it('gives an unknown and an unusable username the identical response', async () => {
		// Three ways to be wrong; one indistinguishable answer. Status as well as
		// body, because a difference in either is an account-existence oracle.
		const wrong = await post({ username: 'ada', password: 'wrong password' }, '5.6.7.8');
		const unknown = await post({ username: 'grace', password: 'whatever it is' });
		const unusable = await post({ username: '!!', password: 'whatever it is' });

		expect(unknown?.status).toBe(wrong?.status);
		expect(unknown?.data).toEqual(wrong?.data);
		expect(unusable?.status).toBe(wrong?.status);
		expect(unusable?.data).toEqual(wrong?.data);
	});

	it('takes comparable time for an unknown username and a wrong password', async () => {
		// The point of the dummy hash in verifyPassword. A fast path for "no such
		// user" would tell an attacker which accounts exist.
		//
		// Warmed up first, and medians rather than single samples: the very first
		// request through this action costs ~45ms of one-off module and JIT work,
		// which is by itself enough to make a microsecond-fast early return look
		// like a real hash. Measured cold, this test passes against an
		// implementation that returns early on an unknown username — measured
		// warm it does not. That is the difference between evidence and comfort.
		await post({ username: 'warm-up', password: 'whatever it is' }, '203.0.113.1');

		const time = async (fields: Record<string, string>, address: string) => {
			const started = performance.now();
			await post(fields, address);
			return performance.now() - started;
		};
		const median = (xs: number[]) => xs.sort((x, y) => x - y)[Math.floor(xs.length / 2)];

		const unknown: number[] = [];
		const wrong: number[] = [];
		for (let i = 0; i < 3; i++) {
			unknown.push(
				await time({ username: `nobody-${i}`, password: 'whatever' }, `198.51.100.${i}`)
			);
			wrong.push(await time({ username: 'ada', password: 'wrong password' }, `203.0.113.${i + 2}`));
		}

		// Half, not a quarter: scrypt dominates both paths, so the honest gap is
		// a few percent, while an early return leaves ~1ms against ~90ms.
		expect(median(unknown)).toBeGreaterThan(median(wrong) / 2);
	});

	it('rate-limits by address before it ever looks the account up', async () => {
		// A different username every time, so only the address budget is spent and
		// this can only pass if the ADDRESS gate fired.
		for (let i = 0; i < 10; i++) await post({ username: `nobody-${i}`, password: 'wrong' });
		const result = await post({ username: 'ada', password: PASSWORD });
		// Even the correct password is refused once the address is over budget.
		expect(result?.status).toBe(429);
		expect(result?.data?.error).toBe('login.rate_limited');
	});

	it('does not let one address exhaust another address budget', async () => {
		// NOT 'ada': flooding her name would exhaust login-user:ada as well, and
		// the username gate would answer first.
		for (let i = 0; i < 10; i++) {
			await post({ username: 'nobody-at-all', password: 'wrong' }, '1.1.1.1');
		}
		const result = await post({ username: 'ada', password: 'wrong password' }, '2.2.2.2');
		expect(result?.data?.error).toBe('login.failed');
	});

	it('limits one account even when each attempt comes from a new address', async () => {
		// Every address fresh, so only the USERNAME gate can produce this.
		for (let i = 0; i < 10; i++) await post({ username: 'ada', password: 'wrong' }, `10.0.0.${i}`);
		const result = await post({ username: 'ada', password: 'wrong password' }, '10.0.0.99');
		expect(result?.status).toBe(429);
		expect(result?.data?.error).toBe('login.rate_limited');
	});

	it('honours a same-site redirectTo and refuses one that leaves the site', async () => {
		const deep = await postExpectRedirect({
			username: 'ada',
			password: PASSWORD,
			redirectTo: '/groups/abc'
		});
		expect(deep.redirect.location).toBe('/groups/abc');

		const offsite = await postExpectRedirect(
			{ username: 'ada', password: PASSWORD, redirectTo: '//evil.example' },
			'9.9.9.9'
		);
		expect(offsite.redirect.location).toBe('/groups');
	});
});
