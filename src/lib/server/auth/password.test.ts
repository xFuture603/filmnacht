import { describe, expect, it } from 'vitest';
import {
	hashPassword,
	PASSWORD_MAX,
	PASSWORD_MIN,
	validatePassword,
	verifyPassword
} from './password';

describe('hashPassword', () => {
	it('produces a verifiable hash', async () => {
		const stored = await hashPassword('correct horse battery staple');
		expect(await verifyPassword('correct horse battery staple', stored)).toBe(true);
	});

	it('rejects the wrong password', async () => {
		const stored = await hashPassword('correct horse battery staple');
		expect(await verifyPassword('Correct horse battery staple', stored)).toBe(false);
	});

	it('salts, so the same password hashes differently every time', async () => {
		const a = await hashPassword('same password');
		const b = await hashPassword('same password');
		expect(a).not.toBe(b);
		expect(await verifyPassword('same password', a)).toBe(true);
		expect(await verifyPassword('same password', b)).toBe(true);
	});

	it('never stores the password itself', async () => {
		const stored = await hashPassword('hunter2');
		expect(stored).not.toContain('hunter2');
	});

	it('records the scheme, so a future change can be told apart', async () => {
		expect(await hashPassword('x')).toMatch(/^scrypt\$/);
	});
});

describe('verifyPassword', () => {
	it('returns false for an account with no password rather than throwing', async () => {
		expect(await verifyPassword('anything', null)).toBe(false);
	});

	it('returns false for a stored value it cannot parse', async () => {
		expect(await verifyPassword('anything', 'not-a-hash')).toBe(false);
		expect(await verifyPassword('anything', 'scrypt$only-two$')).toBe(false);
	});

	it('refuses a stored value whose key segment decodes to nothing', async () => {
		// The exact bypass: '!!!' is a non-empty string that decodes to zero
		// bytes, so a keylen derived from it made every password match.
		expect(await verifyPassword('any password at all', 'scrypt$AAAA$!!!')).toBe(false);
		expect(await verifyPassword('a different one', 'scrypt$AAAA$!!!')).toBe(false);
	});

	it('refuses a stored value whose key segment is the wrong length', async () => {
		const shortKey = Buffer.alloc(32).toString('base64url');
		const salt = Buffer.alloc(16).toString('base64url');
		expect(await verifyPassword('any password at all', `scrypt$${salt}$${shortKey}`)).toBe(false);
	});

	it('refuses a stored value whose salt is the wrong length', async () => {
		const key = Buffer.alloc(64).toString('base64url');
		expect(await verifyPassword('any password at all', `scrypt$AAAA$${key}`)).toBe(false);
	});

	it('does not let an oversized stored value dictate how much work it does', async () => {
		// A huge key segment used to become a huge keylen. Now it is simply the
		// wrong length and is refused, so this must be fast, not a 10MB allocation.
		const huge = Buffer.alloc(1_000_000).toString('base64url');
		const started = Date.now();
		expect(await verifyPassword('any password at all', `scrypt$AAAA$${huge}`)).toBe(false);
		// Still does one real scrypt for timing, so allow for that, but nothing
		// proportional to the input.
		expect(Date.now() - started).toBeLessThan(1000);
	});

	it('takes comparable time for a wrong password and an unparseable one', async () => {
		// Not a strict timing assertion — just proof that the unparseable path
		// still does the work, rather than returning early and leaking that the
		// account has no usable password.
		const stored = await hashPassword('right');
		const wrong = Date.now();
		await verifyPassword('wrong', stored);
		const wrongMs = Date.now() - wrong;
		const bad = Date.now();
		await verifyPassword('wrong', 'not-a-hash');
		const badMs = Date.now() - bad;
		expect(badMs).toBeGreaterThan(wrongMs / 4);
	});
});

describe('validatePassword', () => {
	it('accepts a password at the minimum length', () => {
		expect(validatePassword('a'.repeat(PASSWORD_MIN))).toHaveLength(PASSWORD_MIN);
	});

	it('rejects one character short', () => {
		expect(validatePassword('a'.repeat(PASSWORD_MIN - 1))).toBeNull();
	});

	it('rejects an absurdly long one, which would only burn CPU', () => {
		expect(validatePassword('a'.repeat(PASSWORD_MAX + 1))).toBeNull();
	});

	it('does not trim, because spaces are legitimate password characters', () => {
		const spaced = ' '.repeat(4) + 'abcdefgh';
		expect(validatePassword(spaced)).toBe(spaced);
	});

	it('rejects empty and non-string input', () => {
		expect(validatePassword('')).toBeNull();
		expect(validatePassword(null)).toBeNull();
	});
});
