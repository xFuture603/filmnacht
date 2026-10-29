import { render } from 'svelte/server';
import { describe, expect, it } from 'vitest';
import GroupTabs from './GroupTabs.svelte';

describe('the group tabs', () => {
	// On a 320px phone "Der Pool" wrapped onto two lines in a fit-to-content bar.
	it('share the full width on phones and never wrap a label', () => {
		const { body } = render(GroupTabs, {
			props: { groupId: 'g1', groupName: 'Kino', active: 'pool', locale: 'de', isOwner: true }
		});
		const nav = body.match(/<nav class="([^"]*)"/)![1].split(' ');
		expect(nav).toEqual(expect.arrayContaining(['w-full', 'sm:w-fit']));
		const tabs = body.match(/<a class="tab [^"]*"/g)!;
		expect(tabs).toHaveLength(3);
		for (const tab of tabs) expect(tab).toMatch(/\bflex-1\b.*\bwhitespace-nowrap\b/);
	});

	// With new-count badges the label and badge did not fit side by side on a
	// phone; the badge wrapped out of the fixed-height pill.
	it('stacks the new-count badge under its label on phones, inside a growing tab', () => {
		const { body } = render(GroupTabs, {
			props: {
				groupId: 'g1',
				groupName: 'Kino',
				active: 'pool',
				locale: 'de',
				isOwner: true,
				counts: { pool: 3, nights: 2 }
			}
		});
		for (const tab of body.match(/<a class="(tab [^"]*)"/g)!) {
			expect(tab.split(/[ "]/)).toEqual(
				expect.arrayContaining(['max-sm:h-auto', 'max-sm:flex-col', 'max-sm:gap-0.5'])
			);
		}
	});
});
