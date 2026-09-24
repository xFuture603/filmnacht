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
		// early — and it is the OLDEST window that goes, never the flooder's, so
		// whether a key is cheaply enumerable says nothing about whether it
		// survives. Every limiter sharing this map is evictable, the IP-keyed
		// ones included. Do not write "this key cannot be evicted" at any call
		// site; it is not true of any of them.
		//
		// What an enumerable key space actually costs is the flood itself. Only a
		// caller whose key the caller's caller chooses — /login's login-user:
		// gate, keyed on a submitted username — can fill this map on purpose; an
		// IP address or a user id cannot be minted at will.
		//
		// ponytail: filling it needs 10,000 live windows at once, which against a
		// 300s window is >=33 req/s sustained, and cycling the map to evict one
		// specific key then costs ~10,000 insertions — more requests than the
		// guesses it buys, with that window's TTL expiring on much the same
		// schedule. So below that rate nothing here is evicted and above it every
		// limiter degrades continuously. Upgrade, if a public instance ever makes
		// the flood pay: one map per limiter class, so flooding one cannot evict
		// another.
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
