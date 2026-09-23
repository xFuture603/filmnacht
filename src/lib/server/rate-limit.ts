type Window = { count: number; resetAt: number };

const windows = new Map<string, Window>();

const MAX_WINDOWS = 10_000;

/**
 * ponytail: in-process fixed window. Resets on restart and does not span
 * replicas — correct for the single-container deployment in PRD §11. Swap for a
 * shared store only if filmnacht ever runs more than one instance. IP-keyed
 * limiting is also only as good as the client address: it depends on the
 * reverse proxy being configured not to let clients forge X-Forwarded-For.
 */
export function rateLimit(key: string, limit = 10, windowMs = 60_000, now = Date.now()): boolean {
	const window = windows.get(key);
	if (window && window.resetAt > now) {
		if (window.count >= limit) return false;
		window.count++;
		return true;
	}

	if (windows.size >= MAX_WINDOWS) {
		for (const [k, w] of windows) if (w.resetAt <= now) windows.delete(k);
		// Still full means every window is live, so expiry-based pruning cannot
		// help. Map iterates in insertion order, so dropping from the front
		// evicts the oldest. Evicting a live window hands that key a fresh budget
		// early. That is safe only while every key is not cheaply enumerable by an
		// attacker — a user id (as used by the invite-create limiter) qualifies
		// just as an IP address does. A future caller that keys this map on
		// attacker-chosen input, such as a login handler keyed on a submitted
		// username, must not rely on it for brute-force protection: an attacker
		// could cheaply enumerate that key space and evict a victim's window early.
		while (windows.size >= MAX_WINDOWS) {
			const oldest = windows.keys().next();
			if (oldest.done) break;
			windows.delete(oldest.value);
		}
	}

	windows.set(key, { count: 1, resetAt: now + windowMs });
	return true;
}

export function resetRateLimits(): void {
	windows.clear();
}
