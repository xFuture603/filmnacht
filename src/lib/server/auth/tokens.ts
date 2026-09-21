import { createHash, randomBytes } from 'node:crypto';

/** 16 bytes = 128 bits of entropy (PRD §12), base64url so it is safe in a path. */
export function generateToken(): string {
	return randomBytes(16).toString('base64url');
}

/**
 * Tokens are full-entropy random values, not passwords, so a fast hash is the
 * right tool: there is nothing to brute-force. Lookup is by hash, so a leaked
 * database contains no usable credential.
 */
export function hashToken(token: string): string {
	return createHash('sha256').update(token).digest('hex');
}
