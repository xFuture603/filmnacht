import { beforeAll, describe, expect, it, vi } from 'vitest';

// Mocked before the SUT import so `hooks.server.ts`'s `import { db } from
// '$lib/server/db'` resolves to an in-memory database instead of ever
// touching the real singleton. Pattern from join.test.ts. No test file
// imported hooks.server.ts before this one, so the sliding-refresh cookie
// path had zero coverage of any kind.
vi.mock('$lib/server/db', async () => {
	const { createDb, applyMigrations } = await import('./lib/server/db/client');
	const { db } = createDb(':memory:');
	applyMigrations(db);
	return { db };
});

const { db } = await import('$lib/server/db');
const { eq } = await import('drizzle-orm');
const { sessions } = await import('./lib/server/db/schema');
const { SESSION_COOKIE, createSession } = await import('$lib/server/auth/session');
const { hashToken } = await import('$lib/server/auth/tokens');
const { createUser } = await import('$lib/server/users');
const { setSetting } = await import('$lib/server/settings');
const { handle, handleError } = await import('./hooks.server');

// guardRedirect funnels every path to /setup until this is set — done once,
// for every test in this file, rather than per test.
beforeAll(() => {
	setSetting(db, 'setup_complete', '1');
});

const user = createUser(db, {
	username: 'ada',
	displayName: 'Ada',
	passwordHash: 'scrypt$placeholder$placeholder'
});

function cookieSpy(sessionToken: string) {
	return {
		get: vi.fn((name: string) => (name === SESSION_COOKIE ? sessionToken : undefined)),
		set: vi.fn(),
		delete: vi.fn()
	};
}

// Pushes a freshly minted session's expiry back to 5 of its 30 days
// remaining — past validateSession's halfway point — so the sliding-refresh
// branch in `handle` fires on the very next request, exactly as it would for
// a real returning visitor. Mirrors how the whole-branch review aged a
// session row directly in SQLite to exercise this path live.
function mintSessionNearingExpiry(): string {
	const { token } = createSession(db, user.id);
	db.update(sessions)
		.set({ expiresAt: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000) })
		.where(eq(sessions.id, hashToken(token)))
		.run();
	return token;
}

async function requestThroughHandle(origin: string) {
	const token = mintSessionNearingExpiry();
	const cookies = cookieSpy(token);
	const event = {
		request: new Request('http://localhost/groups'),
		cookies,
		url: new URL('/groups', origin),
		locals: {}
	};
	await handle({ event, resolve: async () => new Response('ok') } as never);
	return cookies;
}

describe('sliding session refresh sets the cookie with the right secure flag', () => {
	it('is not secure over plain http', async () => {
		const cookies = await requestThroughHandle('http://localhost');

		expect(cookies.set).toHaveBeenCalledWith(
			SESSION_COOKIE,
			expect.any(String),
			expect.objectContaining({ secure: false })
		);
	});

	it('is secure over https', async () => {
		const cookies = await requestThroughHandle('https://filmnacht.example');

		expect(cookies.set).toHaveBeenCalledWith(
			SESSION_COOKIE,
			expect.any(String),
			expect.objectContaining({ secure: true })
		);
	});
});

describe('handleError keeps path tokens out of the log', () => {
	// SvelteKit's default logger prints the request URL, and every token this
	// app issues lives in a path. On the production build a FOREIGN KEY failure
	// inside the reset action logged `[500] POST /reset/cONuogJsOHRgB07ew8yaoA`
	// — a live single-use credential, written to a file that outlives the
	// request. Same class as the SMTP credentials mail.ts refuses to log.
	const TOKEN = 'cONuogJsOHRgB07ew8yaoA';

	function logFrom(routeId: string | null, path: string) {
		const logged: unknown[] = [];
		vi.spyOn(console, 'error').mockImplementation((...args) => logged.push(...args));
		handleError({
			error: new Error('FOREIGN KEY constraint failed'),
			event: {
				request: new Request(`http://localhost${path}`, { method: 'POST' }),
				url: new URL(`http://localhost${path}`),
				route: { id: routeId }
			},
			status: 500,
			message: 'Internal Error'
		} as never);
		vi.restoreAllMocks();
		return logged.map((e) => (e instanceof Error ? e.stack : String(e))).join(' ');
	}

	it('logs the route pattern and not the token', () => {
		const logged = logFrom('/reset/[token]', `/reset/${TOKEN}`);
		expect(logged).not.toContain(TOKEN);
		expect(logged).toContain('/reset/[token]');
	});

	it('still reports the status, the method and the error itself', () => {
		const logged = logFrom('/reset/[token]', `/reset/${TOKEN}`);
		expect(logged).toContain('500');
		expect(logged).toContain('POST');
		expect(logged).toContain('FOREIGN KEY constraint failed');
	});

	it('logs nothing from the URL even when the request matched no route', () => {
		// route.id is null for a request that reached no route. Falling back to
		// the pathname here would put the token straight back in the log.
		const logged = logFrom(null, `/login/${TOKEN}`);
		expect(logged).not.toContain(TOKEN);
		expect(logged).toContain('unrouted');
	});
});
