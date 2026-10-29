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
});
