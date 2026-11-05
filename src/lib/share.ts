import { t, type Locale } from '$lib/i18n';

export type ShareResult = 'shared' | 'copied' | 'cancelled' | 'failed';

/** The whole message, link included: some apps drop a separate url field. */
export function shareText(
	locale: Locale,
	film: { title: string; year: number | null },
	group: string,
	url: string
): string {
	return t(locale, 'film.share_text', {
		film: film.year ? `${film.title} (${film.year})` : film.title,
		group,
		url
	});
}

const isIPhone = (nav: Pick<Navigator, 'userAgent'>) => nav.userAgent.includes('iPhone');

/**
 * The poster as a file to attach, or null to share the text alone. Fetch it
 * ahead of the tap: Safari only allows sharing right after one, so waiting for
 * the network inside the click would refuse the share.
 */
export async function posterFile(url: string | null): Promise<File | null> {
	if (!url || !navigator.canShare || isIPhone(navigator)) return null;
	try {
		const response = await fetch(url, { referrerPolicy: 'no-referrer' });
		if (!response.ok) return null;
		const blob = await response.blob();
		return new File([blob], 'poster.jpg', { type: blob.type || 'image/jpeg' });
	} catch {
		return null;
	}
}

/**
 * The device's share menu where there is one, otherwise the clipboard. An iPhone
 * gets the clipboard too: WhatsApp keeps only the link from its share menu, while
 * pasting keeps the whole message.
 */
export async function shareOrCopy(
	text: string,
	poster: File | null,
	nav: Pick<Navigator, 'share' | 'canShare' | 'clipboard' | 'userAgent'> = navigator
): Promise<ShareResult> {
	if (nav.share && !isIPhone(nav)) {
		const withPoster = poster ? { files: [poster], text } : null;
		try {
			await nav.share(withPoster && nav.canShare?.(withPoster) ? withPoster : { text });
			return 'shared';
		} catch (err) {
			// Closing the menu is a choice, not a failure.
			if ((err as Error).name === 'AbortError') return 'cancelled';
		}
	}
	try {
		await nav.clipboard.writeText(text);
		return 'copied';
	} catch {
		return 'failed';
	}
}
