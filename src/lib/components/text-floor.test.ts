import { describe, expect, it } from 'vitest';

// Nothing below 14px, and every control a 48px target. daisyUI's small badge
// sets 12px text; a 36px close button is hard to hit with a thumb.
const sources = import.meta.glob('/src/**/*.svelte', {
	query: '?raw',
	import: 'default',
	eager: true
}) as Record<string, string>;

describe('the size floor', () => {
	it('uses no small badge anywhere', () => {
		const small = Object.entries(sources).filter(([, s]) => /\bbadge-sm\b/.test(s));
		expect(small.map(([path]) => path)).toEqual([]);
	});

	it('uses no 12px icon anywhere', () => {
		const tiny = Object.entries(sources).filter(([, s]) =>
			/<[A-Z]\w*[^>]*class="[^"]*\bsize-3\b/.test(s)
		);
		expect(tiny.map(([path]) => path)).toEqual([]);
	});

	it('gives the toast close button a 48px target', () => {
		const toast = sources['/src/lib/components/Toast.svelte'];
		const close = toast.match(/<button[\s\S]*?>/)?.[0] ?? '';
		expect(close).toMatch(/\bsize-12\b/);
		expect(close).not.toMatch(/\b(size-9|min-h-9|btn-sm)\b/);
	});
});
