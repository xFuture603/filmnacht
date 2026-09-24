import { isRedirect } from '@sveltejs/kit';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mocked before the SUT import so `+page.server.ts`'s `import { db } from
// '$lib/server/db'` resolves to an in-memory database instead of ever
// touching the real singleton. Pattern from join.test.ts.
vi.mock('$lib/server/db', async () => {
	const { createDb, applyMigrations } = await import('../../../lib/server/db/client');
	const { db } = createDb(':memory:');
	applyMigrations(db);
	return { db };
});

const { db } = await import('$lib/server/db');
const { SESSION_COOKIE } = await import('$lib/server/auth/session');
const { createUser, regenerateLoginToken } = await import('../../../lib/server/users');
const { resetRateLimits } = await import('$lib/server/rate-limit');
const { load } = await import('./+page.server');

function cookieSpy() {
	return { set: vi.fn(), get: vi.fn(), delete: vi.fn() };
}

// The link is reusable (not consumed on use, per PRD §9 — see profile.test.ts
// for the revocation behaviour), so the same token works for both requests
// below.
const user = createUser(db, {
	username: 'ada',
	displayName: 'Ada',
	passwordHash: 'scrypt$placeholder$placeholder'
});
const token = regenerateLoginToken(db, user.id);

beforeEach(() => {
	resetRateLimits();
});

// load() redirects on success (see @sveltejs/kit's Redirect, thrown not
// returned), so it has to be awaited inside a try/catch.
async function get(origin: string) {
	const cookies = cookieSpy();
	try {
		await load({
			params: { token },
			cookies,
			getClientAddress: () => '1.2.3.4',
			url: new URL(`/login/${token}`, origin)
		} as never);
	} catch (err) {
		if (isRedirect(err)) return cookies;
		throw err;
	}
	throw new Error('expected load to redirect, but it returned normally');
}

describe('session cookie secure flag', () => {
	it('is not secure over plain http', async () => {
		const cookies = await get('http://localhost');

		expect(cookies.set).toHaveBeenCalledWith(
			SESSION_COOKIE,
			expect.any(String),
			expect.objectContaining({ secure: false })
		);
	});

	it('is secure over https', async () => {
		const cookies = await get('https://filmnacht.example');

		expect(cookies.set).toHaveBeenCalledWith(
			SESSION_COOKIE,
			expect.any(String),
			expect.objectContaining({ secure: true })
		);
	});
});
