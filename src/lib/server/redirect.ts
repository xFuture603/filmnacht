/**
 * Only ever bounce back to a path on this instance. A leading slash alone is
 * not enough: `//host` is protocol-relative and leaves the site, and some
 * browsers normalise a backslash to a forward slash, so `/\host` escapes too.
 */
export function safeRedirectPath(raw: unknown, fallback = '/'): string {
	const value = typeof raw === 'string' ? raw : '';
	if (!value.startsWith('/')) return fallback;
	if (value.startsWith('//') || value.startsWith('/\\')) return fallback;
	return value;
}
