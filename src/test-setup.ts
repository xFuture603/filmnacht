import { beforeEach, vi } from 'vitest';

/**
 * No test may ever reach a real mail server. This repo's `.env` carries live
 * SMTP credentials (see mail.ts), so a test file that forgets to mock
 * `$lib/server/mail` — or, inside mail.test.ts itself, forgets to mock
 * `nodemailer` for a particular case — must not become the one that emails a
 * stranger.
 *
 * Registered as a Vitest `setupFiles` entry, so it applies to every test file.
 * The `vi.mock` below covers the very first test to run; the `beforeEach`
 * covers every test after it. Both are needed: mail.test.ts's own `afterEach`
 * calls `vi.doUnmock('nodemailer')` after EVERY test in that file — including
 * ones that never mocked nodemailer themselves — to clean up its own per-test
 * `vi.doMock('nodemailer', …)` overrides. That call does not distinguish "a
 * mock this file set" from "the mock this setup file set"; it just clears the
 * registry entry, which would otherwise leave later tests in that file
 * unguarded. Re-applying in `beforeEach` closes that gap without mail.test.ts
 * having to know this guard exists. A test's own `vi.doMock('nodemailer', …)`
 * still overrides this for that one test, exactly as before.
 */
function rejectingTransport() {
	return {
		default: {
			createTransport: () => ({
				sendMail: () => Promise.reject(new Error('tests never send real mail'))
			})
		}
	};
}

vi.mock('nodemailer', rejectingTransport);

beforeEach(() => {
	vi.doMock('nodemailer', rejectingTransport);
});
