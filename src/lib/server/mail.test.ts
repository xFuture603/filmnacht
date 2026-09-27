import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => {
	vi.resetModules();
	vi.restoreAllMocks();
	vi.doUnmock('$env/dynamic/private');
	vi.doUnmock('nodemailer');
});

/**
 * Mocks the env module rather than writing to process.env. SvelteKit's
 * `$env/dynamic/private` snapshots the environment when Vite loads its config,
 * so a test that sets process.env sees nothing — every variable reads as
 * undefined and the module under test looks unconfigured no matter what.
 */
async function loadMail(vars: Record<string, string | undefined>) {
	vi.resetModules();
	vi.doMock('$env/dynamic/private', () => ({
		env: Object.fromEntries(Object.entries(vars).filter(([, v]) => v !== undefined))
	}));
	return import('./mail');
}

const CONFIGURED = {
	SMTP_HOST: 'smtp.example.com',
	SMTP_FROM: 'filmnacht@example.com'
};

describe('isMailConfigured', () => {
	it('is false when no SMTP host is set', async () => {
		const { isMailConfigured } = await loadMail({ ...CONFIGURED, SMTP_HOST: undefined });
		expect(isMailConfigured()).toBe(false);
	});

	it('is false when a host is set but SMTP_FROM is missing', async () => {
		// Without a From address the message is rejected by most servers, so a
		// half-configured instance must report itself unconfigured rather than
		// fail at send time on every single reset.
		const { isMailConfigured } = await loadMail({ ...CONFIGURED, SMTP_FROM: undefined });
		expect(isMailConfigured()).toBe(false);
	});

	it('is true with a host and a from address', async () => {
		const { isMailConfigured } = await loadMail(CONFIGURED);
		expect(isMailConfigured()).toBe(true);
	});
});

describe('sendMail', () => {
	it('returns false rather than throwing when mail is not configured', async () => {
		const { sendMail } = await loadMail({ ...CONFIGURED, SMTP_HOST: undefined });
		await expect(sendMail('ada@example.com', 'subject', 'body')).resolves.toBe(false);
	});

	it('returns true when the transport accepts the message', async () => {
		// The happy path, asserted deliberately: without it every other test in
		// this file passes against a sendMail that returns false unconditionally.
		const sent: unknown[] = [];
		vi.doMock('nodemailer', () => ({
			default: {
				createTransport: () => ({
					sendMail: async (message: unknown) => {
						sent.push(message);
						return { accepted: ['ada@example.com'] };
					}
				})
			}
		}));
		const { sendMail } = await loadMail(CONFIGURED);
		await expect(sendMail('ada@example.com', 'subject', 'body')).resolves.toBe(true);
		expect(sent).toHaveLength(1);
		vi.doUnmock('nodemailer');
	});

	it('returns false and leaks no SMTP secret when the transport throws', async () => {
		// Review Focus 4. Mail libraries put the host, the user and sometimes the
		// password into the error and its .response. None of it may reach a log
		// line, a response body, or a thrown error SvelteKit would render.
		const PASSWORD = 'hunter2-should-never-appear';
		const USER = 'postmaster@example.com';

		vi.doMock('nodemailer', () => ({
			default: {
				createTransport: () => ({
					sendMail: async () => {
						// Shaped like a real nodemailer failure, which carries the
						// credentials it was given straight back out.
						const err = new Error(`Invalid login: 535 auth failed for ${USER}`);
						Object.assign(err, {
							response: `535 5.7.8 Username and Password not accepted: ${USER} / ${PASSWORD}`,
							command: 'AUTH PLAIN'
						});
						throw err;
					}
				})
			}
		}));

		const logged: string[] = [];
		vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
			logged.push(args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' '));
		});

		const { sendMail } = await loadMail({
			...CONFIGURED,
			SMTP_USER: USER,
			SMTP_PASS: PASSWORD
		});

		await expect(sendMail('ada@example.com', 'subject', 'body')).resolves.toBe(false);

		const all = logged.join('\n');
		expect(all).not.toContain(PASSWORD);
		expect(all).not.toContain(USER);
		expect(all).toContain('SMTP');
		vi.doUnmock('nodemailer');
	});
});

/** A nodemailer whose send either succeeds or throws `failure`. */
function fakeNodemailer(failure?: Error & { code?: string }) {
	vi.doMock('nodemailer', () => ({
		default: {
			createTransport: () => ({
				sendMail: async () => {
					if (failure) throw failure;
					return { accepted: ['admin@example.com'] };
				}
			})
		}
	}));
}

describe('mailStatus', () => {
	it('tells the admin what is configured, and never the credentials', async () => {
		const { mailStatus } = await loadMail({
			...CONFIGURED,
			SMTP_PORT: '465',
			SMTP_USER: 'mailer-login-name',
			SMTP_PASS: 'hunter2-should-never-appear'
		});
		const status = mailStatus();
		expect(status).toEqual({
			configured: true,
			host: 'smtp.example.com',
			port: 465,
			from: 'filmnacht@example.com',
			login: true
		});
		// This object is serialised into the admin page.
		expect(JSON.stringify(status)).not.toContain('hunter2');
		expect(JSON.stringify(status)).not.toContain('mailer-login-name');
	});

	it('reports an unconfigured instance plainly', async () => {
		const { mailStatus } = await loadMail({});
		expect(mailStatus()).toMatchObject({ configured: false, host: null, from: null, login: false });
	});
});

describe('sendTestMail', () => {
	it('says so when the message went out', async () => {
		fakeNodemailer();
		const { sendTestMail } = await loadMail(CONFIGURED);
		expect(await sendTestMail('admin@example.com')).toEqual({ ok: true });
	});

	it('names the failure by its code, never by its message', async () => {
		// Nodemailer's messages can quote the server's reply, which can echo the
		// login. Only the code reaches the page.
		const failure = Object.assign(new Error('535 auth failed for hunter2-should-never-appear'), {
			code: 'EAUTH'
		});
		fakeNodemailer(failure);
		vi.spyOn(console, 'error').mockImplementation(() => {});
		const { sendTestMail } = await loadMail({
			...CONFIGURED,
			SMTP_PASS: 'hunter2-should-never-appear'
		});
		const result = await sendTestMail('admin@example.com');
		expect(result).toEqual({ ok: false, code: 'EAUTH' });
		expect(JSON.stringify(result)).not.toContain('hunter2');
	});

	it('reports an unknown failure without inventing a code', async () => {
		fakeNodemailer(new Error('something odd'));
		vi.spyOn(console, 'error').mockImplementation(() => {});
		const { sendTestMail } = await loadMail(CONFIGURED);
		expect(await sendTestMail('admin@example.com')).toEqual({ ok: false, code: 'UNKNOWN' });
	});

	it('does not try when mail is not configured', async () => {
		const { sendTestMail } = await loadMail({});
		expect(await sendTestMail('admin@example.com')).toEqual({ ok: false, code: 'NOT_CONFIGURED' });
	});
});

describe('the global test guard (src/test-setup.ts)', () => {
	// No `vi.doMock('nodemailer', …)` here, deliberately: this proves the
	// SETUP FILE's mock is what stops the send, not one written into this
	// test. Without it, a configured instance would try to reach
	// smtp.example.com for real — see the RED evidence in the fix report.
	it('still never reaches a real transport when a test forgets to mock nodemailer', async () => {
		vi.spyOn(console, 'error').mockImplementation(() => {});
		const { sendMail, sendTestMail } = await loadMail(CONFIGURED);
		await expect(sendMail('ada@example.com', 'subject', 'body')).resolves.toBe(false);
		// UNKNOWN, specifically: the guard's rejection carries no `.code`, unlike
		// a real network failure (ENOTFOUND, ECONNREFUSED, ETIMEDOUT, …), so this
		// also tells apart "hit the guard" from "hit the network and failed".
		await expect(sendTestMail('admin@example.com')).resolves.toEqual({
			ok: false,
			code: 'UNKNOWN'
		});
	});
});
