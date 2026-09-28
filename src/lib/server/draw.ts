import { randomInt } from 'node:crypto';

/**
 * PRD §6. Rolling, so founding members are not penalised for years, and so a
 * member the draw has skipped throughout the window carries the same weight as
 * somebody who joined yesterday — as far as the app can tell, both have been
 * waiting.
 */
export const FAIRNESS_WINDOW_NIGHTS = 10;

export type Candidate = {
	userId: string;
	/** Their OPEN suggestions in this group. A candidate with none never wins. */
	suggestionIds: string[];
	/** Films of theirs WATCHED in the window — never merely drawn (PRD §6). */
	watchedInWindow: number;
};

export type DrawLogEntry = {
	at: string;
	seed: number;
	/** The owner who pressed Draw (R13), or `null` for the automatic scheduler. */
	by: string | null;
	mode: 'fairness' | 'uniform';
	candidates: Array<{ userId: string; weight: number; suggestions: number }>;
	pickedUserId: string;
	pickedSuggestionId: string;
	/** Present on a re-draw: who re-ran it and why (PRD §6). */
	reason?: string;
};

/** `1 / (1 + watched)`. Monotonic, never zero, maximum for somebody untouched. */
export function weightFor(watchedInWindow: number): number {
	return 1 / (1 + Math.max(0, watchedInWindow));
}

/**
 * A seed from a cryptographically secure source (PRD §6 names `crypto.randomInt`
 * and rules out `Math.random`). The seed is what gets logged, so the draw has to
 * be reproducible FROM it — which is why the selection below runs a deterministic
 * generator rather than calling randomInt for each choice. Logging randomInt's
 * outputs would record the answer instead of the means.
 */
export function newSeed(): number {
	return randomInt(0, 2 ** 31 - 1);
}

/** mulberry32: small, fast, and deterministic for a given seed. */
function generator(seed: number): () => number {
	let a = seed >>> 0;
	return () => {
		a = (a + 0x6d2b79f5) >>> 0;
		let t = Math.imul(a ^ (a >>> 15), 1 | a);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

/**
 * Two stages, and the order is the point (PRD §6): a person is drawn first, then
 * one of that person's films uniformly. Drawing across all films instead would
 * give somebody who entered ten of them ten times the chance of somebody who
 * entered one, and the per-member cap would have to carry a load it was not
 * meant for.
 */
export function drawFrom(
	candidates: Candidate[],
	mode: 'fairness' | 'uniform',
	seed: number
): { userId: string; suggestionId: string; candidates: DrawLogEntry['candidates'] } | null {
	const eligible = candidates.filter((c) => c.suggestionIds.length > 0);
	if (eligible.length === 0) return null;

	const weights = eligible.map((c) => (mode === 'uniform' ? 1 : weightFor(c.watchedInWindow)));
	const log = eligible.map((c, i) => ({
		userId: c.userId,
		weight: weights[i],
		suggestions: c.suggestionIds.length
	}));

	const next = generator(seed);
	const total = weights.reduce((sum, w) => sum + w, 0);
	let roll = next() * total;
	// Falls back to the last candidate, which is where floating-point rounding
	// lands when the roll is a hair above the running total.
	let index = eligible.length - 1;
	for (let i = 0; i < eligible.length; i++) {
		roll -= weights[i];
		if (roll < 0) {
			index = i;
			break;
		}
	}

	const who = eligible[index];
	const films = who.suggestionIds;
	const suggestionId = films[Math.floor(next() * films.length)] ?? films[films.length - 1];
	return { userId: who.userId, suggestionId, candidates: log };
}
