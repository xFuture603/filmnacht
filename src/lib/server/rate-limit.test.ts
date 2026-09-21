import { beforeEach, describe, expect, it } from 'vitest';
import { rateLimit, resetRateLimits } from './rate-limit';

beforeEach(resetRateLimits);

describe('rateLimit', () => {
	it('allows up to the limit and then refuses', () => {
		for (let i = 0; i < 5; i++) expect(rateLimit('ip:1.2.3.4', 5, 60_000, 0)).toBe(true);
		expect(rateLimit('ip:1.2.3.4', 5, 60_000, 0)).toBe(false);
	});

	it('starts a fresh window once the old one has passed', () => {
		for (let i = 0; i < 5; i++) rateLimit('ip:1.2.3.4', 5, 60_000, 0);
		expect(rateLimit('ip:1.2.3.4', 5, 60_000, 60_001)).toBe(true);
	});

	it('counts each key separately', () => {
		for (let i = 0; i < 5; i++) rateLimit('ip:1.1.1.1', 5, 60_000, 0);
		expect(rateLimit('ip:2.2.2.2', 5, 60_000, 0)).toBe(true);
	});
});
