import { describe, expect, it } from 'vitest';
import { safePosterUrl } from './movies';

describe('safePosterUrl', () => {
	it('accepts an http URL', () => {
		expect(safePosterUrl('http://example.com/poster.jpg')).toBe('http://example.com/poster.jpg');
	});

	it('accepts an https URL', () => {
		expect(safePosterUrl('https://example.com/poster.jpg')).toBe('https://example.com/poster.jpg');
	});

	it('rejects a javascript: URL', () => {
		expect(safePosterUrl('javascript:alert(1)')).toBeNull();
	});

	it('rejects a data: URL', () => {
		expect(safePosterUrl('data:text/html,<script>alert(1)</script>')).toBeNull();
	});

	it('rejects a bare path with no scheme', () => {
		expect(safePosterUrl('/p.jpg')).toBeNull();
	});

	it('rejects an empty string', () => {
		expect(safePosterUrl('')).toBeNull();
	});

	it('rejects a non-string', () => {
		expect(safePosterUrl(undefined)).toBeNull();
		expect(safePosterUrl(null)).toBeNull();
		expect(safePosterUrl(12345)).toBeNull();
	});

	it('rejects a URL over the length limit', () => {
		const tooLong = 'https://example.com/' + 'a'.repeat(500);
		expect(safePosterUrl(tooLong)).toBeNull();
	});
});
