/**
 * Reloads a page's data while it is on screen, so films and nights other
 * members add show up without a manual reload. Polling, not a server push: a
 * group plans nights days ahead, and this needs nothing from the server or a
 * reverse proxy. A hidden tab stops polling; coming back refreshes at once,
 * whether by switching tabs (visibility) or windows (focus: two windows side
 * by side never change visibility).
 *
 * Returns a stop function, for onMount's cleanup.
 */
export function startLiveRefresh(
	refresh: () => unknown,
	{
		intervalMs = 30_000,
		doc = document,
		win = window
	}: {
		intervalMs?: number;
		doc?: Pick<Document, 'visibilityState' | 'addEventListener' | 'removeEventListener'>;
		win?: Pick<Window, 'addEventListener' | 'removeEventListener'>;
	} = {}
): () => void {
	let timer: ReturnType<typeof setInterval> | undefined;

	const start = () => {
		timer ??= setInterval(refresh, intervalMs);
	};
	const pause = () => {
		clearInterval(timer);
		timer = undefined;
	};
	const onVisibility = () => {
		if (doc.visibilityState === 'visible') {
			refresh();
			start();
		} else {
			pause();
		}
	};

	if (doc.visibilityState === 'visible') start();
	doc.addEventListener('visibilitychange', onVisibility);
	win.addEventListener('focus', onVisibility);
	return () => {
		pause();
		doc.removeEventListener('visibilitychange', onVisibility);
		win.removeEventListener('focus', onVisibility);
	};
}
