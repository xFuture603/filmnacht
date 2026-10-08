import { describe, expect, it } from 'vitest';
import { originMismatch } from './origin';

describe('originMismatch', () => {
	it('is false when the browser is where the server thinks it is', () => {
		expect(originMismatch('https://filmnacht.example.org', 'https://filmnacht.example.org')).toBe(
			false
		);
		// Default ports are the same origin.
		expect(
			originMismatch('https://filmnacht.example.org', 'https://filmnacht.example.org:443')
		).toBe(false);
	});

	it('catches a different host, port or scheme', () => {
		expect(originMismatch('http://localhost:3000', 'http://127.0.0.1:3000')).toBe(true);
		expect(originMismatch('http://localhost:300', 'http://localhost:3000')).toBe(true);
		// ORIGIN unset behind a proxy: the server assumes https and the proxy's upstream host.
		expect(originMismatch('https://filmnacht:3000', 'https://filmnacht.example.org')).toBe(true);
		expect(originMismatch('https://localhost:3000', 'http://localhost:3000')).toBe(true);
	});

	it('does not raise a false alarm on something it cannot parse', () => {
		expect(originMismatch('', 'http://localhost:3000')).toBe(false);
	});
});
