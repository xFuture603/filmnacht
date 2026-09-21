type Window = { count: number; resetAt: number };

const windows = new Map<string, Window>();

/**
 * ponytail: in-process fixed window. Resets on restart and does not span
 * replicas — correct for the single-container deployment in PRD §11. Swap for a
 * shared store only if filmnacht ever runs more than one instance.
 */
export function rateLimit(key: string, limit = 10, windowMs = 60_000, now = Date.now()): boolean {
	if (windows.size > 10_000) {
		for (const [k, w] of windows) if (w.resetAt <= now) windows.delete(k);
	}
	const window = windows.get(key);
	if (!window || window.resetAt <= now) {
		windows.set(key, { count: 1, resetAt: now + windowMs });
		return true;
	}
	if (window.count >= limit) return false;
	window.count++;
	return true;
}

export function resetRateLimits(): void {
	windows.clear();
}
