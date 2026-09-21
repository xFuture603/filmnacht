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

	it('bounds its memory under key churn instead of growing without limit', () => {
		expect(rateLimit('victim', 1, 60_000, 0)).toBe(true);
		expect(rateLimit('victim', 1, 60_000, 0)).toBe(false);

		for (let i = 0; i < 10_001; i++) rateLimit(`flood:${i}`, 1, 60_000, 0);

		// 'victim' was evicted to keep the map bounded, so it starts fresh —
		// which is the observable consequence of the cap actually applying.
		expect(rateLimit('victim', 1, 60_000, 0)).toBe(true);
	});
});
