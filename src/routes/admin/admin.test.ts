import { isHttpError } from '@sveltejs/kit';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { hashPassword, verifyPassword } from '$lib/server/auth/password';
import { createSession, validateSession } from '$lib/server/auth/session';
import { applyMigrations, createDb, type DB } from '$lib/server/db/client';
import { passwordResets } from '$lib/server/db/schema';
import { addMember, createGroup, listGroupsFor } from '$lib/server/groups';
import { resetRateLimits } from '$lib/server/rate-limit';
import { consumeReset } from '$lib/server/resets';
import { getEmailLocale, getTimezone } from '$lib/server/settings';
import {
	createUser,
	regenerateLoginToken,
	setEmail,
	storedPasswordHash,
	userByLoginToken
} from '$lib/server/users';

let db: DB;

// A fresh database per test, read through a getter so the route's module-scope
// `import { db }` picks up the reassignment instead of binding the first one.
vi.mock('$lib/server/db', () => ({
	get db() {
		return db;
	}
}));

// No real SMTP in tests: a fake whose status and send result each test sets.
let mailConfigured = true;
let testMailResult: { ok: true } | { ok: false; code: string } = { ok: true };
const testMailsTo: string[] = [];
vi.mock('$lib/server/mail', () => ({
	isMailConfigured: () => mailConfigured,
	sendMail: async () => mailConfigured,
	mailStatus: () => ({
		configured: mailConfigured,
		host: mailConfigured ? 'smtp.example.com' : null,
		port: 587,
		from: mailConfigured ? 'filmnacht@example.com' : null,
		login: true
	}),
	sendTestMail: async (to: string) => {
		testMailsTo.push(to);
		return testMailResult;
	}
}));

const { actions, load } = await import('./+page.server');
// The other half of the shared re-auth bucket, imported to prove the two
// routes really do draw on one budget. See the last test in this file.
const { actions: profileActions } = await import('../profile/+page.server');

const ADMIN_PASSWORD = 'the admin password';
const ADA_PASSWORD = 'adas own password';

// Hashed once at module scope: scrypt is deliberately ~100ms.
const ADMIN_HASH = await hashPassword(ADMIN_PASSWORD);
const ADA_HASH = await hashPassword(ADA_PASSWORD);

let admin: { id: string };
let ada: { id: string };
let grace: { id: string };

type Caller = { id: string; displayName: string; isAdmin: boolean } | null;
const asAdmin = (): Caller => ({ id: admin.id, displayName: 'Admin', isAdmin: true });
const asAda = (): Caller => ({ id: ada.id, displayName: 'Ada', isAdmin: false });

/** Either shape this action can answer with: an ActionFailure, or a success. */
type Answer = {
	status?: number;
	data?: { error?: string };
	recoveryUrl?: string;
	recoveredName?: string;
};

async function post(user: Caller, fields: Record<string, string>): Promise<Answer> {
	return ((await actions.recover({
		locals: { user, locale: 'en' },
		request: new Request('http://localhost/admin', {
			method: 'POST',
			body: new URLSearchParams(fields)
		}),
		url: new URL('http://localhost/admin')
	} as never)) ?? {}) as Answer;
}

/** requireUser and requireAdmin throw an HttpError rather than returning fail(). */
async function statusOfThrow(run: () => unknown | Promise<unknown>) {
	try {
		await run();
	} catch (err) {
		if (isHttpError(err)) return err.status;
		throw err;
	}
	throw new Error('expected a throw, but it returned normally');
}

beforeEach(() => {
	db = createDb(':memory:').db;
	applyMigrations(db);
	resetRateLimits();
	admin = createUser(db, {
		username: 'admin',
		displayName: 'Admin',
		passwordHash: ADMIN_HASH,
		isAdmin: true
	});
	ada = createUser(db, { username: 'ada', displayName: 'Ada', passwordHash: ADA_HASH });
	grace = createUser(db, {
		username: 'grace',
		displayName: 'Grace',
		passwordHash: 'scrypt$placeholder$placeholder'
	});
});

describe('GET /admin', () => {
	it('lists every account on the instance', () => {
		const data = load({ locals: { user: asAdmin(), locale: 'en' } } as never) as {
			members: Array<{ username: string }>;
		};
		expect(data.members.map((m) => m.username)).toEqual(['ada', 'admin', 'grace']);
	});

	it('never sends a password hash or a token hash to the browser', () => {
		// This return value is serialised into the page. A hash here is a hash in
		// the admin's HTML source, ready for an offline attack.
		const data = load({ locals: { user: asAdmin(), locale: 'en' } } as never) as {
			members: Array<Record<string, unknown>>;
		};
		expect(Object.keys(data.members[0]).sort()).toEqual(['displayName', 'id', 'username']);
	});

	it('refuses a member who is not the instance admin', async () => {
		expect(
			await statusOfThrow(() => load({ locals: { user: asAda(), locale: 'en' } } as never))
		).toBe(403);
	});

	it('refuses a signed-out visitor', async () => {
		expect(await statusOfThrow(() => load({ locals: { user: null, locale: 'en' } } as never))).toBe(
			401
		);
	});
});

describe('POST /admin?/recover', () => {
	it('mints a one-time recovery link for a member', async () => {
		// The happy path, asserted first and deliberately: without it every refusal
		// below passes against an action that does nothing at all.
		//
		// The WHOLE return value, not `result?.data?.recoveryUrl`: a success is a
		// plain object with no `.data` at all — only fail() produces one — so
		// asserting through `.data` reads undefined and fails against a correct
		// action.
		const result = await post(asAdmin(), {
			userId: ada.id,
			currentPassword: ADMIN_PASSWORD
		});
		expect(result).toEqual({
			recoveryUrl: expect.stringMatching(/^http:\/\/localhost\/reset\/[A-Za-z0-9_-]+$/),
			recoveredName: 'Ada'
		});

		expect(db.select().from(passwordResets).all()).toHaveLength(1);
		// Not just shaped like a link: the token in it must actually resolve to
		// Ada's account, which is the only thing that makes it a recovery.
		const token = result.recoveryUrl!.split('/').pop()!;
		expect(consumeReset(db, token)).toBe(ada.id);
		// And once, as the copy promises.
		expect(consumeReset(db, token)).toBeNull();
	});

	it('leaves every credential alone until the link is used', async () => {
		// Minting is not revocation. An admin may generate a link the member never
		// uses, and until they do, nothing about their account may change — the
		// sweep belongs to /reset/<token>, which is where the member finds out.
		// Grace is here for the other half: recovering one account must not touch
		// anybody else's.
		const adasSession = createSession(db, ada.id);
		const adasLink = regenerateLoginToken(db, ada.id);
		const gracesSession = createSession(db, grace.id);
		const gracesLink = regenerateLoginToken(db, grace.id);

		await post(asAdmin(), { userId: ada.id, currentPassword: ADMIN_PASSWORD });

		expect(validateSession(db, adasSession.token)?.user.id).toBe(ada.id);
		expect(userByLoginToken(db, adasLink)?.id).toBe(ada.id);
		expect(await verifyPassword(ADA_PASSWORD, storedPasswordHash(db, ada.id))).toBe(true);

		expect(validateSession(db, gracesSession.token)?.user.id).toBe(grace.id);
		expect(userByLoginToken(db, gracesLink)?.id).toBe(grace.id);
		// One reset row, and it belongs to Ada. A mint that also minted for every
		// account would pass every assertion above.
		const rows = db.select().from(passwordResets).all();
		expect(rows).toHaveLength(1);
		expect(rows[0].userId).toBe(ada.id);
	});

	it('refuses a member who is not the instance admin and mints nothing', async () => {
		expect(
			await statusOfThrow(() => post(asAda(), { userId: admin.id, currentPassword: ADA_PASSWORD }))
		).toBe(403);
		expect(db.select().from(passwordResets).all()).toHaveLength(0);
	});

	it('refuses a signed-out visitor and mints nothing', async () => {
		expect(
			await statusOfThrow(() => post(null, { userId: ada.id, currentPassword: ADMIN_PASSWORD }))
		).toBe(401);
		expect(db.select().from(passwordResets).all()).toHaveLength(0);
	});

	it('refuses an admin who cannot produce their own password', async () => {
		// An admin's unlocked laptop must not be a master key. Decision 21 gated
		// revealing your OWN link; minting one for somebody else is stronger.
		const result = await post(asAdmin(), {
			userId: ada.id,
			currentPassword: 'not the admin password'
		});
		expect(result?.status).toBe(400);
		expect(result?.data).toEqual({ error: 'profile.error.current_password' });
		expect(db.select().from(passwordResets).all()).toHaveLength(0);
	});

	it('refuses an admin who sends no password at all', async () => {
		const result = await post(asAdmin(), { userId: ada.id });
		expect(result?.status).toBe(400);
		expect(result?.data).toEqual({ error: 'profile.error.current_password' });
		expect(db.select().from(passwordResets).all()).toHaveLength(0);
	});

	it('refuses a user id that does not exist', async () => {
		const result = await post(asAdmin(), {
			userId: 'no-such-user',
			currentPassword: ADMIN_PASSWORD
		});
		expect(result?.status).toBe(400);
		expect(result?.data).toEqual({ error: 'admin.error.no_such_member' });
		expect(db.select().from(passwordResets).all()).toHaveLength(0);
	});

	it('draws on the same re-auth budget as the profile actions', async () => {
		// The shared bucket is load-bearing, not tidiness waiting to happen: all
		// three actions verify the SAME secret, so a key per action would hand an
		// attacker 5 + 5 + 5 guesses against one password instead of 5. This test
		// is what fails if someone later splits `reauth:${userId}` into three
		// self-documenting keys.
		for (let i = 0; i < 5; i++) {
			await post(asAdmin(), { userId: ada.id, currentPassword: `guess ${i}` });
		}
		const locked = await profileActions.reveal({
			locals: { user: asAdmin(), locale: 'en' },
			request: new Request('http://localhost/profile', {
				method: 'POST',
				body: new URLSearchParams({ currentPassword: ADMIN_PASSWORD })
			}),
			cookies: { get: () => undefined, set: vi.fn(), delete: vi.fn() },
			url: new URL('http://localhost/profile')
		} as never);
		expect((locked as Answer)?.status).toBe(429);
		// The admin's own budget, not the instance's: Ada must still be able to
		// prove herself on her own account.
		const adasOwn = await profileActions.reveal({
			locals: { user: asAda(), locale: 'en' },
			request: new Request('http://localhost/profile', {
				method: 'POST',
				body: new URLSearchParams({ currentPassword: ADA_PASSWORD })
			}),
			cookies: { get: () => undefined, set: vi.fn(), delete: vi.fn() },
			url: new URL('http://localhost/profile')
		} as never);
		expect((adasOwn as { loginUrl?: string })?.loginUrl).toMatch(/\/login\//);
	});
});

async function act(
	name: 'timezone' | 'emailLocale' | 'testMail',
	user: Caller,
	fields: Record<string, string> = {}
): Promise<Record<string, unknown>> {
	return (await actions[name]({
		locals: { user, locale: 'en' },
		request: new Request('http://localhost/admin', {
			method: 'POST',
			body: new URLSearchParams(fields)
		})
	} as never)) as Record<string, unknown>;
}

describe('instance settings on /admin', () => {
	beforeEach(() => {
		mailConfigured = true;
		testMailResult = { ok: true };
		testMailsTo.length = 0;
	});

	it('shows the timezone and where mail points', () => {
		const data = load({ locals: { user: asAdmin(), locale: 'en' } } as never) as {
			timezone: string;
			mail: { configured: boolean; host: string | null };
			tmdb: boolean;
		};
		expect(data.timezone).toBe('UTC');
		expect(data.mail).toMatchObject({ configured: true, host: 'smtp.example.com' });
		expect(typeof data.tmdb).toBe('boolean');
	});

	it('lets the admin change the timezone, and only to a real one', async () => {
		expect(await act('timezone', asAdmin(), { timezone: 'Europe/Berlin' })).toEqual({
			timezoneSaved: true
		});
		expect(getTimezone(db)).toBe('Europe/Berlin');
		expect(await act('timezone', asAdmin(), { timezone: 'Mars/Olympus_Mons' })).toMatchObject({
			status: 400,
			data: { error: 'setup.error.timezone' }
		});
		expect(getTimezone(db)).toBe('Europe/Berlin');
	});

	it('refuses a member who is not the admin', async () => {
		expect(await statusOfThrow(() => act('timezone', asAda(), { timezone: 'Europe/Berlin' }))).toBe(
			403
		);
		expect(getTimezone(db)).toBe('UTC');
		expect(await statusOfThrow(() => act('testMail', asAda()))).toBe(403);
		expect(testMailsTo).toEqual([]);
	});

	it('shows the default email language and lets the admin change it', () => {
		const data = load({ locals: { user: asAdmin(), locale: 'en' } } as never) as {
			emailLocale: string;
		};
		expect(data.emailLocale).toBe('en');
	});

	it('lets the admin set the draw email language, and only to en or de', async () => {
		expect(await act('emailLocale', asAdmin(), { locale: 'de' })).toEqual({
			emailLocaleSaved: true
		});
		expect(getEmailLocale(db)).toBe('de');
		expect(await act('emailLocale', asAdmin(), { locale: 'fr' })).toMatchObject({
			status: 400,
			data: { error: 'admin.error.email_locale' }
		});
		expect(getEmailLocale(db)).toBe('de');
	});

	it('refuses a member who is not the admin, and changes nothing', async () => {
		expect(await statusOfThrow(() => act('emailLocale', asAda(), { locale: 'de' }))).toBe(403);
		expect(getEmailLocale(db)).toBe('en');
	});

	it('asks for an email address on the profile before sending a test', async () => {
		expect(await act('testMail', asAdmin())).toMatchObject({
			status: 400,
			data: { error: 'admin.error.no_email' }
		});
		expect(testMailsTo).toEqual([]);
	});

	it('sends the test to the admin’s own address and says so', async () => {
		setEmail(db, admin.id, 'admin@example.com');
		expect(await act('testMail', asAdmin())).toEqual({ mailSent: 'admin@example.com' });
		expect(testMailsTo).toEqual(['admin@example.com']);
	});

	it('turns a failure code into a hint the admin can act on', async () => {
		setEmail(db, admin.id, 'admin@example.com');
		testMailResult = { ok: false, code: 'EAUTH' };
		expect(await act('testMail', asAdmin())).toMatchObject({
			status: 400,
			data: { mailCode: 'EAUTH', mailHint: 'auth' }
		});
		testMailResult = { ok: false, code: 'ETIMEDOUT' };
		expect(await act('testMail', asAdmin())).toMatchObject({ data: { mailHint: 'connection' } });
	});
});

describe('deleting a group from /admin', () => {
	let groupId: string;
	beforeEach(() => {
		groupId = createGroup(db, { name: 'Filmnacht', ownerId: ada.id });
		addMember(db, grace.id, groupId);
	});

	const remove = (user: Caller, fields: Record<string, string>) =>
		actions.deleteGroup({
			locals: { user, locale: 'en' },
			request: new Request('http://localhost/admin', {
				method: 'POST',
				body: new URLSearchParams(fields)
			}),
			url: new URL('http://localhost/admin')
		} as never);

	it('lists every group with its owner and size', async () => {
		const data = (await load({ locals: { user: asAdmin(), locale: 'en' } } as never)) as {
			groups: unknown[];
		};
		expect(data.groups).toEqual([{ id: groupId, name: 'Filmnacht', owner: 'Ada', members: 2 }]);
	});

	it('deletes a group the admin does not own, once its name is typed', async () => {
		expect(await remove(asAdmin(), { groupId, name: 'Filmnacht' })).toEqual({
			deletedGroup: 'Filmnacht'
		});
		expect(listGroupsFor(db, ada.id)).toEqual([]);
	});

	it('refuses a wrong name', async () => {
		expect(await remove(asAdmin(), { groupId, name: 'Nope' })).toMatchObject({
			status: 400,
			data: { error: 'settings.error.delete_name' }
		});
		expect(listGroupsFor(db, ada.id)).toHaveLength(1);
	});

	it('refuses anyone who is not the instance admin, the owner included', async () => {
		expect(await statusOfThrow(() => remove(asAda(), { groupId, name: 'Filmnacht' }))).toBe(403);
		expect(listGroupsFor(db, ada.id)).toHaveLength(1);
	});
});
