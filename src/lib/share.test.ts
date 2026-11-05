import { describe, expect, it, vi } from 'vitest';
import { shareOrCopy, shareText } from './share';

const poster = new File(['x'], 'poster.jpg', { type: 'image/jpeg' });
const nav = (over: object = {}) =>
	({
		share: vi.fn(async () => {}),
		canShare: vi.fn(() => true),
		clipboard: { writeText: vi.fn(async () => {}) },
		...over
	}) as never as Pick<Navigator, 'share' | 'canShare' | 'clipboard'>;

describe('shareText', () => {
	it('names the film, its year, the group and the link, in the sharer’s language', () => {
		const film = { title: 'Dune', year: 2021 };
		expect(shareText('en', film, 'Filmclub', 'https://x/y')).toBe(
			'What do you think about this film?\n\nDune (2021)\nFrom our group “Filmclub” on Filmnacht\n\nhttps://x/y'
		);
		expect(shareText('de', film, 'Filmclub', 'https://x/y')).toContain('Aus unserer Gruppe');
	});

	it('leaves out a year it does not have, and does not expand braces in a title', () => {
		expect(shareText('en', { title: '{url}', year: null }, 'G', 'https://x')).toContain(
			'\n{url}\nFrom'
		);
	});
});

describe('shareOrCopy', () => {
	it('attaches the poster when the device can share files', async () => {
		const n = nav();
		expect(await shareOrCopy('hi', poster, n)).toBe('shared');
		expect(n.share).toHaveBeenCalledWith({ files: [poster], text: 'hi' });
	});

	it('shares the text alone when there is no poster or files are not supported', async () => {
		const n = nav({ canShare: vi.fn(() => false) });
		await shareOrCopy('hi', poster, n);
		expect(n.share).toHaveBeenCalledWith({ text: 'hi' });
		const none = nav();
		await shareOrCopy('hi', null, none);
		expect(none.share).toHaveBeenCalledWith({ text: 'hi' });
	});

	it('copies when there is no share menu', async () => {
		const n = nav({ share: undefined });
		expect(await shareOrCopy('hi', poster, n)).toBe('copied');
		expect(n.clipboard.writeText).toHaveBeenCalledWith('hi');
	});

	it('does nothing more when the menu is closed', async () => {
		const n = nav({
			share: vi.fn(async () => {
				throw new DOMException('closed', 'AbortError');
			})
		});
		expect(await shareOrCopy('hi', null, n)).toBe('cancelled');
		expect(n.clipboard.writeText).not.toHaveBeenCalled();
	});

	it('falls back to copying when the share is refused', async () => {
		const n = nav({
			share: vi.fn(async () => {
				throw new DOMException('no', 'NotAllowedError');
			})
		});
		expect(await shareOrCopy('hi', null, n)).toBe('copied');
	});

	it('reports failure when neither works, as on a page without HTTPS', async () => {
		expect(await shareOrCopy('hi', null, nav({ share: undefined, clipboard: undefined }))).toBe(
			'failed'
		);
	});
});
