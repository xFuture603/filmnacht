import { isRedirect } from '@sveltejs/kit';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mocked before the SUT import so `+page.server.ts`'s `import { db } from
// '$lib/server/db'` resolves to an in-memory database instead of ever
// touching the real singleton. Pattern from join.test.ts.
vi.mock('$lib/server/db', async () => {
	const { createDb, applyMigrations } = await import('../../lib/server/db/client');
	const { db } = createDb(':memory:');
	applyMigrations(db);
	return { db };
});

const { db } = await import('$lib/server/db');
const { users, settings } = await import('../../lib/server/db/schema');
const { SESSION_COOKIE } = await import('$lib/server/auth/session');
const { actions } = await import('./+page.server');

function cookieSpy() {
	return { set: vi.fn(), get: vi.fn(), delete: vi.fn() };
}

function formRequest(fields: Record<string, string>) {
	const form = new FormData();
	for (const [k, v] of Object.entries(fields)) form.append(k, v);
	return new Request('http://localhost/setup', { method: 'POST', body: form });
}

const validFields = {
	username: 'admin',
	displayName: 'Admin',
	password: 'a fine password here',
	passwordRepeat: 'a fine password here',
	timezone: 'Europe/Berlin'
};

// redirect() throws (see @sveltejs/kit's Redirect), so a successful setup
// must be awaited inside a try/catch rather than read off a return value.
async function postExpectRedirect(cookies: ReturnType<typeof cookieSpy>, origin: string) {
	try {
		await actions.default({
			request: formRequest(validFields),
			cookies,
			url: new URL('/setup', origin)
		} as never);
	} catch (err) {
		if (isRedirect(err)) return;
		throw err;
	}
	throw new Error('expected the action to redirect, but it returned normally');
}

// claimInstance is one-shot per instance by design (setup_complete gates it),
// so — unlike join.test.ts's fresh-username trick — each test here needs the
// db wiped rather than just a new username, or the second test's setup POST
// 403s as "already done" instead of ever reaching setSessionCookie.
beforeEach(() => {
	db.delete(users).run();
	db.delete(settings).run();
});

describe('session cookie secure flag', () => {
	it('is not secure over plain http', async () => {
		const cookies = cookieSpy();
		await postExpectRedirect(cookies, 'http://localhost');

		expect(cookies.set).toHaveBeenCalledWith(
			SESSION_COOKIE,
			expect.any(String),
			expect.objectContaining({ secure: false })
		);
	});

	it('is secure over https', async () => {
		const cookies = cookieSpy();
		await postExpectRedirect(cookies, 'https://filmnacht.example');

		expect(cookies.set).toHaveBeenCalledWith(
			SESSION_COOKIE,
			expect.any(String),
			expect.objectContaining({ secure: true })
		);
	});
});

describe('an optional email address at setup', () => {
	async function setup(email: string) {
		try {
			return await actions.default({
				request: formRequest({ ...validFields, email }),
				cookies: cookieSpy(),
				url: new URL('/setup', 'http://localhost')
			} as never);
		} catch (err) {
			if (isRedirect(err)) return 'redirected';
			throw err;
		}
	}

	it("stores the admin's address", async () => {
		expect(await setup('Admin@Example.org')).toBe('redirected');
		expect(db.select({ email: users.email }).from(users).get()?.email).toBe('admin@example.org');
	});

	it('refuses an invalid address and claims nothing', async () => {
		expect(await setup('nope')).toMatchObject({
			status: 400,
			data: { error: 'profile.error.email' }
		});
		expect(db.select().from(users).all()).toHaveLength(0);
	});
});
