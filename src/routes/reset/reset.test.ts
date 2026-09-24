import { beforeEach, describe, expect, it, vi } from 'vitest';
import { hashToken } from '$lib/server/auth/tokens';
import { applyMigrations, createDb, type DB } from '$lib/server/db/client';
import { passwordResets } from '$lib/server/db/schema';
import { resetRateLimits } from '$lib/server/rate-limit';
import { createUser, setEmail } from '$lib/server/users';

let db: DB;
let adaId: string;

// A fresh database per test, so this hands out a getter instead of the
// module-scope singleton login.test.ts builds: the route's `import { db }`
// re-reads it through the getter on every access.
vi.mock('$lib/server/db', () => ({
	get db() {
		return db;
	}
}));

let mailConfigured = true;
let sendOutcome: boolean | Promise<boolean> = true;
const sent: Array<{ to: string; subject: string; body: string }> = [];

// One mock with mutable behaviour rather than vi.doMock + vi.resetModules per
// test: resetting the module registry hands the route a SECOND copy of
// rate-limit.ts, whose window map this file's resetRateLimits — bound to the
// first copy — no longer clears, and the rate-limit tests below would then be
// asserting against a limiter nobody reset. The property under test is the
// identical response, not the mocking style.
vi.mock('$lib/server/mail', () => ({
	isMailConfigured: () => mailConfigured,
	sendMail: (to: string, subject: string, body: string) => {
		// Mirrors mail.ts: an unconfigured instance refuses without sending.
		if (!mailConfigured) return Promise.resolve(false);
		sent.push({ to, subject, body });
		return Promise.resolve(sendOutcome);
	}
}));

const { actions, load } = await import('./+page.server');

async function post(fields: Record<string, string>, address = '1.2.3.4') {
	const result = await actions.default({
		request: new Request('http://localhost/reset', {
			method: 'POST',
			body: new URLSearchParams(fields)
		}),
		getClientAddress: () => address,
		url: new URL('http://localhost/reset')
	} as never);
	// The route mints the token and sends the mail on a timer, deliberately, so
	// that work which only happens for a KNOWN address cannot be timed by the
	// caller. Let that timer run before asserting on its effects — every test
	// below that inspects password_resets or `sent` depends on this line.
	await new Promise((resolve) => setTimeout(resolve, 0));
	return result;
}

beforeEach(() => {
	db = createDb(':memory:').db;
	applyMigrations(db);
	resetRateLimits();
	sent.length = 0;
	sendOutcome = true;
	mailConfigured = true;
	adaId = createUser(db, {
		username: 'ada',
		displayName: 'Ada',
		passwordHash: 'scrypt$placeholder$placeholder'
	}).id;
	setEmail(db, adaId, 'ada@example.com');
});

describe('GET /reset', () => {
	it('tells the page whether this instance can send mail at all', () => {
		// Static, and a property of the INSTANCE rather than of any address, so
		// the page is allowed to say it out loud. What may never vary is the
		// answer to a submission.
		mailConfigured = false;
		expect(load({ locals: { user: null, locale: 'en' } } as never)).toEqual({
			mailConfigured: false
		});
		mailConfigured = true;
		expect(load({ locals: { user: null, locale: 'en' } } as never)).toEqual({
			mailConfigured: true
		});
	});
});

describe('POST /reset', () => {
	it('mints a token and mails its link to an address that has an account', async () => {
		// The happy path, asserted first and deliberately: without it every other
		// test here passes against a route that does nothing at all.
		const result = await post({ email: 'ada@example.com' });
		expect(result).toEqual({ success: 'reset.sent' });
		expect(sent).toHaveLength(1);
		expect(sent[0].to).toBe('ada@example.com');

		const rows = db.select().from(passwordResets).all();
		expect(rows).toHaveLength(1);
		expect(rows[0].userId).toBe(adaId);

		// The link has to carry the token that was actually minted. A route that
		// mails a link built from anything else mails a dead one, and every other
		// assertion in this test still passes.
		const token = sent[0].body.match(/\/reset\/([A-Za-z0-9_-]+)/)?.[1];
		expect(token).toBeTruthy();
		expect(hashToken(token!)).toBe(rows[0].tokenHash);
	});

	it('has done none of the known-address work by the time it answers', async () => {
		// Pins the deferral without measuring a clock. The insert and the
		// transport construction are the only work that happens for a real
		// address and not an invented one, so if they ran before the reply the
		// reply's timing would carry them — a ~1.4ms signal on ~1.7ms. Asserting
		// that the row does not exist YET is the same property, stated in a way
		// that cannot go flaky on a loaded machine.
		//
		// A timing test here would be the kind this project has twice been bitten
		// by: one measured cold that passed against a vulnerable login.
		const pending = actions.default({
			request: new Request('http://localhost/reset', {
				method: 'POST',
				body: new URLSearchParams({ email: 'ada@example.com' })
			}),
			getClientAddress: () => '9.9.9.9',
			url: new URL('http://localhost/reset')
		} as never);

		expect(await pending).toEqual({ success: 'reset.sent' });
		expect(db.select().from(passwordResets).all()).toHaveLength(0);

		await new Promise((resolve) => setTimeout(resolve, 0));
		expect(db.select().from(passwordResets).all()).toHaveLength(1);
	});

	it('answers an unknown address identically and mints nothing', async () => {
		const unknown = await post({ email: 'grace@example.com' });
		const known = await post({ email: 'ada@example.com' }, '5.6.7.8');
		expect(unknown).toEqual(known);
		expect(unknown?.status).toBe(known?.status);
		expect(sent.map((s) => s.to)).toEqual(['ada@example.com']);
		expect(db.select().from(passwordResets).all()).toHaveLength(1);
	});

	it('answers identically when the mail server refuses the message', async () => {
		// Review Focus 1. If a refused send looked different, reachability would
		// be an oracle for which addresses have accounts.
		sendOutcome = false;
		const failed = await post({ email: 'ada@example.com' });
		sendOutcome = true;
		const ok = await post({ email: 'ada@example.com' }, '5.6.7.8');
		expect(failed).toEqual(ok);
		expect(failed?.status).toBe(ok?.status);
	});

	it('answers identically on an instance with no SMTP configured at all', async () => {
		mailConfigured = false;
		const unconfigured = await post({ email: 'ada@example.com' });
		mailConfigured = true;
		const configured = await post({ email: 'ada@example.com' }, '5.6.7.8');
		expect(unconfigured).toEqual(configured);
		expect(unconfigured?.status).toBe(configured?.status);
		expect(sent).toHaveLength(1);
	});

	it('answers without waiting for the mail server', async () => {
		// Identical bytes are only half of it. mail.ts allows a dead host 10s to
		// connect and 20s on the socket, so an AWAITED send answers a known
		// address up to twenty seconds later than an unknown one: same answer,
		// different arrival, same enumeration oracle — and a page that hangs,
		// which Review Focus 1 forbids in as many words.
		//
		// Deliberately not a clock reading. The send is held open until after the
		// assertion has run, so a route that awaits it cannot pass by being fast.
		let release!: () => void;
		sendOutcome = new Promise<boolean>((resolve) => {
			release = () => resolve(false);
		});
		const result = await post({ email: 'ada@example.com' });
		expect(result).toEqual({ success: 'reset.sent' });
		release();
	});

	it('matches the address case-insensitively and ignores surrounding space', async () => {
		await post({ email: '  ADA@Example.com  ' });
		expect(sent).toHaveLength(1);
		expect(sent[0].to).toBe('ada@example.com');
	});

	it('refuses something that is not an address and mints nothing', async () => {
		const result = await post({ email: 'not-an-address' });
		expect(result?.data?.error).toBe('reset.error.email');
		expect(db.select().from(passwordResets).all()).toHaveLength(0);
	});

	it('rate-limits by client address before it looks anything up', async () => {
		for (let i = 0; i < 5; i++) await post({ email: `nobody-${i}@example.com` });
		const result = await post({ email: 'ada@example.com' });
		expect(result?.status).toBe(429);
		expect(result?.data?.error).toBe('reset.rate_limited');
		expect(sent).toHaveLength(0);
	});

	it('counts a junk submission against the client-address budget', async () => {
		// The client-address gate is first and unconditional. A gate placed after
		// validation would let an attacker spend unlimited requests on this
		// action for free by never submitting a well-formed address.
		for (let i = 0; i < 5; i++) await post({ email: 'not-an-address' });
		const result = await post({ email: 'ada@example.com' });
		expect(result?.status).toBe(429);
	});

	it('does not let one client address exhaust another one budget', async () => {
		for (let i = 0; i < 5; i++) await post({ email: `nobody-${i}@example.com` }, '1.1.1.1');
		const result = await post({ email: 'ada@example.com' }, '2.2.2.2');
		expect(result).toEqual({ success: 'reset.sent' });
	});

	it('bounds an address with no account exactly like one that has an account', async () => {
		// The address gate runs BEFORE the lookup, so hammering one address looks
		// the same whether or not it belongs to anybody. A gate applied only to
		// real accounts would make a 429 the oracle that the reply text is
		// carefully not.
		for (let i = 0; i < 5; i++) await post({ email: 'grace@example.com' }, `10.0.0.${i}`);
		const unknown = await post({ email: 'grace@example.com' }, '10.0.0.99');
		for (let i = 0; i < 5; i++) await post({ email: 'ada@example.com' }, `10.1.0.${i}`);
		const known = await post({ email: 'ada@example.com' }, '10.1.0.99');
		expect(unknown).toEqual(known);
		expect(unknown?.status).toBe(known?.status);
	});

	it('also bounds one address hammered from many client addresses', async () => {
		// Defence in depth, and second: this key is attacker-chosen, so it can
		// never be the only gate.
		for (let i = 0; i < 5; i++) await post({ email: 'ada@example.com' }, `10.0.0.${i}`);
		const result = await post({ email: 'ada@example.com' }, '10.0.0.99');
		expect(result?.status).toBe(429);
		expect(result?.data?.error).toBe('reset.rate_limited');
	});
});
