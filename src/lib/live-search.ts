/**
 * Search as you type: waits for a pause in typing, skips text too short to
 * mean anything, and cancels a search still in flight when a newer one starts,
 * so a slow old answer can never overwrite a fresh one.
 */
export function liveSearch<T>({
	url,
	onResults,
	onError,
	delay = 300,
	min = 2,
	fetchImpl = fetch
}: {
	url: (query: string) => string;
	/** null: the text is too short, so there is nothing to show. */
	onResults: (results: T[] | null) => void;
	onError: () => void;
	delay?: number;
	min?: number;
	fetchImpl?: typeof fetch;
}) {
	let timer: ReturnType<typeof setTimeout> | undefined;
	let inFlight: AbortController | undefined;

	function cancel() {
		clearTimeout(timer);
		inFlight?.abort();
	}

	async function now(text: string) {
		cancel();
		const query = text.trim();
		if (query.length < min) return onResults(null);
		const controller = (inFlight = new AbortController());
		try {
			const response = await fetchImpl(url(query), { signal: controller.signal });
			if (!response.ok) throw new Error(`search ${response.status}`);
			const body = (await response.json()) as { results: T[] };
			if (!controller.signal.aborted) onResults(body.results);
		} catch {
			if (!controller.signal.aborted) onError();
		}
	}

	function type(text: string) {
		cancel();
		if (text.trim().length < min) return onResults(null);
		timer = setTimeout(() => now(text), delay);
	}

	return { type, now };
}
