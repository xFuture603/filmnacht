import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scryptAsync = promisify(scrypt) as (
	password: string,
	salt: Buffer,
	keylen: number,
	options: { N: number; r: number; p: number }
) => Promise<Buffer>;

/**
 * Deliberately slow. These are the Node defaults scaled for a Raspberry Pi 4:
 * roughly 100ms there, less on anything bigger. That cost is the point — it is
 * what makes an offline attack against a leaked hash expensive, and it doubles
 * as a natural brake on online guessing.
 */
const PARAMS = { N: 16384, r: 8, p: 1 };
const SALT_LEN = 16;
const KEYLEN = 64;
const SCHEME = 'scrypt';

export const PASSWORD_MIN = 8;
/** Not a security bound — a cap so nobody can burn CPU with a megabyte password. */
export const PASSWORD_MAX = 200;

export async function hashPassword(password: string): Promise<string> {
	const salt = randomBytes(SALT_LEN);
	const key = await scryptAsync(password, salt, KEYLEN, PARAMS);
	return `${SCHEME}$${salt.toString('base64url')}$${key.toString('base64url')}`;
}

/**
 * Always does the work, even when there is nothing to compare against. An early
 * return for a missing or malformed hash would take microseconds where a real
 * check takes ~100ms, which tells an attacker the account exists but has no
 * password — and, at the route layer, whether the account exists at all.
 */
export async function verifyPassword(password: string, stored: string | null): Promise<boolean> {
	const parts = (stored ?? '').split('$');
	const tagged = parts.length === 3 && parts[0] === SCHEME;
	const salt = tagged ? Buffer.from(parts[1], 'base64url') : Buffer.alloc(0);
	const expected = tagged ? Buffer.from(parts[2], 'base64url') : Buffer.alloc(0);

	// Validate the DECODED lengths, never the string's. A segment can be a
	// non-empty string and still decode to zero bytes ('!!!' has no valid
	// base64url characters), and deriving keylen from it would make the
	// comparison below tautological — every password would then match.
	const usable = salt.length === SALT_LEN && expected.length === KEYLEN;

	// KEYLEN is our own constant on both branches, so the work and the timing are
	// identical whether or not the stored value was usable.
	const actual = await scryptAsync(password, usable ? salt : randomBytes(SALT_LEN), KEYLEN, PARAMS);
	if (!usable) return false;
	return timingSafeEqual(actual, expected);
}

export function validatePassword(raw: FormDataEntryValue | null): string | null {
	// Not trimmed: a leading or trailing space is a legitimate password character,
	// and silently removing it would lock someone out of their own account.
	const password = typeof raw === 'string' ? raw : '';
	if (password.length < PASSWORD_MIN || password.length > PASSWORD_MAX) return null;
	return password;
}
