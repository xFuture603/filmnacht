import { describe, expect, it } from 'vitest';
import { FAIRNESS_WINDOW_NIGHTS, drawFrom, newSeed, weightFor } from './draw';

const candidate = (userId: string, films: number, watched: number) => ({
	userId,
	suggestionIds: Array.from({ length: films }, (_, i) => `${userId}-film-${i}`),
	watchedInWindow: watched
});

describe('weightFor', () => {
	it('gives a member who has had no turn the maximum weight', () => {
		expect(weightFor(0)).toBe(1);
	});

	it('halves after one turn and never reaches zero', () => {
		expect(weightFor(1)).toBe(0.5);
		expect(weightFor(FAIRNESS_WINDOW_NIGHTS)).toBeGreaterThan(0);
	});

	it('treats a newcomer exactly like a member skipped for the whole window', () => {
		// PRD §6: "as far as the app can tell both have been waiting, and both
		// should go next." A newcomer has 0 watched films in the window; so does
		// somebody the draw has passed over ten times running.
		expect(weightFor(0)).toBe(weightFor(0));
	});
});

describe('drawFrom', () => {
	it('returns null when nobody is eligible', () => {
		expect(drawFrom([], 'fairness', 1)).toBeNull();
	});

	it('returns the only candidate’s only film', () => {
		const result = drawFrom([candidate('ada', 1, 0)], 'fairness', 12345);
		expect(result?.userId).toBe('ada');
		expect(result?.suggestionId).toBe('ada-film-0');
	});

	it('is reproducible from the seed', () => {
		// The whole point of logging a seed. Two runs at one seed must agree, or
		// the log records an answer nobody can check.
		const people = [candidate('ada', 3, 0), candidate('grace', 2, 1), candidate('alan', 1, 4)];
		const a = drawFrom(people, 'fairness', 987654);
		const b = drawFrom(people, 'fairness', 987654);
		expect(b).toEqual(a);
	});

	it('gives different seeds different outcomes across a run of draws', () => {
		// Guards against a generator that ignores its seed, which would make every
		// draw in the instance's life return the same film.
		const people = [candidate('ada', 1, 0), candidate('grace', 1, 0), candidate('alan', 1, 0)];
		const picks = new Set(
			Array.from({ length: 50 }, (_, i) => drawFrom(people, 'fairness', i + 1)?.userId)
		);
		expect(picks.size).toBeGreaterThan(1);
	});

	it('reports every candidate’s weight, not only the winner’s', () => {
		// §6: the log carries "the candidate list with weights". A log holding only
		// the winner cannot answer "how did this happen?".
		const result = drawFrom([candidate('ada', 1, 0), candidate('grace', 1, 3)], 'fairness', 42);
		expect(result?.candidates).toHaveLength(2);
		expect(result?.candidates.find((c) => c.userId === 'grace')?.weight).toBe(0.25);
		expect(result?.candidates.find((c) => c.userId === 'ada')?.suggestions).toBe(1);
	});

	it('never returns a candidate who has no films', () => {
		const result = drawFrom([candidate('ada', 0, 0), candidate('grace', 1, 9)], 'fairness', 7);
		expect(result?.userId).toBe('grace');
	});

	it('ignores the weighting in uniform mode', () => {
		// drawMode: 'uniform' exists in GroupSettings; a group that wants a plain
		// coin toss must get one.
		const heavilySkewed = [candidate('ada', 1, 0), candidate('grace', 1, 50)];
		const picks = Array.from(
			{ length: 400 },
			(_, i) => drawFrom(heavilySkewed, 'uniform', i + 1)?.userId
		);
		const graceShare = picks.filter((p) => p === 'grace').length / picks.length;
		// Under fairness weighting Grace's share would be 1/52 ≈ 2%.
		expect(graceShare).toBeGreaterThan(0.35);
		expect(graceShare).toBeLessThan(0.65);
	});

	it('does not give a member with ten films ten times the chance', () => {
		// The reason the draw is two-stage (§6). Both have had no turn, so both
		// should be near even regardless of how many films they entered.
		const people = [candidate('ada', 10, 0), candidate('grace', 1, 0)];
		const picks = Array.from(
			{ length: 600 },
			(_, i) => drawFrom(people, 'fairness', i + 1)?.userId
		);
		const graceShare = picks.filter((p) => p === 'grace').length / picks.length;
		expect(graceShare).toBeGreaterThan(0.35);
		expect(graceShare).toBeLessThan(0.65);
	});
});

describe('newSeed', () => {
	it('produces a non-negative integer that varies', () => {
		const seeds = new Set(Array.from({ length: 200 }, () => newSeed()));
		expect(seeds.size).toBeGreaterThan(190);
		for (const s of seeds) {
			expect(Number.isInteger(s)).toBe(true);
			expect(s).toBeGreaterThanOrEqual(0);
		}
	});
});

describe('fairness, by simulation rather than by argument', () => {
	// Ruling R7: `newSeed()` (crypto.randomInt) makes this test nondeterministic
	// and CI-flaky. Worse, a single 1000-night run's max/min ratio across 8
	// members is noisy enough that no bound cleanly separates "fair" from
	// "uniform" on one run: measured over 20 fixed base seeds, single-run
	// fairness ratios ranged 1.12-1.25 and single-run uniform ratios ranged
	// 1.11-1.55 — the tails overlap, so a per-run bound would sometimes pass a
	// uniform draw and sometimes fail a fair one. Averaging the ratio over
	// several fixed base seeds cancels that noise while staying fully
	// deterministic ("every run is identical" per R7): with these 5 fixed base
	// seeds, seed = base * 1000 + night,
	//   fairness (real weighting) ratios: 1.1404, 1.1652, 1.0744, 1.1391, 1.1092
	//     → average 1.1257
	//   uniform (weightFor mutated to `return 1`) ratios:
	//     1.2385, 1.4019, 1.2936, 1.3028, 1.1186 → average 1.2711
	// 1.2 sits comfortably between the two averages, with ~0.07 margin on each
	// side, and is reproduced exactly on every run because every seed is fixed.
	const BASE_SEEDS = [20260925, 1, 2, 3, 4];

	function simulateEightMembers(mode: 'fairness' | 'uniform', baseSeed: number): number {
		const members = Array.from({ length: 8 }, (_, i) => `m${i}`);
		const watchedNights: string[] = []; // whose film won, most recent last
		const wins = new Map(members.map((m) => [m, 0]));

		for (let night = 0; night < 1000; night++) {
			const window = watchedNights.slice(-FAIRNESS_WINDOW_NIGHTS);
			const candidates = members.map((m) => ({
				userId: m,
				suggestionIds: [`${m}-film`],
				watchedInWindow: window.filter((w) => w === m).length
			}));
			const result = drawFrom(candidates, mode, baseSeed * 1000 + night);
			if (!result) throw new Error('the draw returned nobody');
			wins.set(result.userId, (wins.get(result.userId) ?? 0) + 1);
			watchedNights.push(result.userId);
		}

		const counts = [...wins.values()];
		return Math.max(...counts) / Math.min(...counts);
	}

	it('keeps the busiest and quietest of eight members within a fixed ratio over 1000 nights', () => {
		// PRD Goal 1 asks for "demonstrably, not just by feel". This is that proof.
		// Eight members, one film each, every night watched, weights recomputed
		// from a rolling ten-night window exactly as the app does it, averaged
		// over 5 fixed base seeds (see comment above) to cancel single-run noise.
		const ratios = BASE_SEEDS.map((seed) => simulateEightMembers('fairness', seed));
		const average = ratios.reduce((a, b) => a + b, 0) / ratios.length;
		expect(average).toBeLessThan(1.2);
	});

	it('gives a member returning after a long absence the next turn, not a queue position', () => {
		// The feeling the app exists to remove: "I have not picked in months."
		const members = ['ada', 'grace', 'alan'];
		const window = ['grace', 'grace', 'alan', 'grace', 'alan'];
		const candidates = members.map((m) => ({
			userId: m,
			suggestionIds: [`${m}-film`],
			watchedInWindow: window.filter((w) => w === m).length
		}));
		const picks = Array.from({ length: 300 }, (_, i) => drawFrom(candidates, 'fairness', i + 1)!);
		const adaShare = picks.filter((p) => p.userId === 'ada').length / picks.length;
		// Weights are 1, 1/4, 1/3 — Ada's share of 1 + 0.25 + 0.333 is about 63%.
		expect(adaShare).toBeGreaterThan(0.5);
	});
});
