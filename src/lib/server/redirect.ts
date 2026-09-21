function hasControlCharacter(value: string): boolean {
	for (const character of value) {
		const code = character.codePointAt(0) ?? 0;
		// C0 controls (includes tab, line feed and carriage return) and DEL.
		if (code < 0x20 || code === 0x7f) return true;
	}
	return false;
}

/**
 * Only ever bounce back to a path on this instance. A leading slash alone is
 * not enough: `//host` is protocol-relative and leaves the site, and some
 * browsers normalise a backslash to a forward slash, so `/\host` escapes too.
 *
 * Browsers strip ASCII tab and newlines before resolving a URL (WHATWG URL
 * Standard), so a value like tab-slash-evil becomes protocol-relative AFTER
 * any prefix check we do here. Rather than modelling that stripping, reject
 * control characters outright — a legitimate path never contains one.
 */
export function safeRedirectPath(raw: unknown, fallback = '/'): string {
	const value = typeof raw === 'string' ? raw : '';
	if (hasControlCharacter(value)) return fallback;
	if (!value.startsWith('/')) return fallback;
	if (value.startsWith('//') || value.startsWith('/\\')) return fallback;
	return value;
}
