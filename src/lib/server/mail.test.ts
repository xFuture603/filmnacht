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
