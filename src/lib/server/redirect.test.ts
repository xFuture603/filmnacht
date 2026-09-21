import { describe, expect, it } from 'vitest';
import { safeRedirectPath } from './redirect';

describe('safeRedirectPath', () => {
	it('keeps an ordinary path on this instance', () => {
		expect(safeRedirectPath('/groups')).toBe('/groups');
		expect(safeRedirectPath('/groups/abc?x=1')).toBe('/groups/abc?x=1');
	});

	it('rejects a protocol-relative URL that only looks like a path', () => {
		expect(safeRedirectPath('//evil.example')).toBe('/');
		expect(safeRedirectPath('/\\evil.example')).toBe('/');
	});

	it('rejects an absolute URL', () => {
		expect(safeRedirectPath('https://evil.example')).toBe('/');
	});

	it('falls back for empty and non-string input', () => {
		expect(safeRedirectPath('')).toBe('/');
		expect(safeRedirectPath(undefined)).toBe('/');
		expect(safeRedirectPath(null)).toBe('/');
	});
});
