import { over, ratio, themes, token } from '$lib/theme-contrast';
import { render } from 'svelte/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('$app/forms', () => ({ enhance: () => ({}) }));
vi.mock('$app/navigation', () => ({
	invalidateAll: () => Promise.resolve(),
	replaceState: () => {},
	afterNavigate: () => {}
}));
const page = vi.hoisted(() => ({ url: new URL('http://localhost/groups/g1') }));
vi.mock('$app/state', () => ({ page }));

const { default: Page } = await import('./+page.svelte');

const entry = (over: Record<string, unknown>) => ({
	suggestionId: 's1',
	title: 'Dune',
	year: 2021,
	posterUrl: null,
	runtime: 155,
	mine: false,
	status: 'open',
	night: null,
	isNew: false,
	drawnFor: null,
	...over
});

function body(
	pool: unknown[],
	members: unknown[] = [],
	next: unknown = null,
	used = 0,
	drawn: unknown[] = [],
	form: unknown = null
) {
	return render(Page, {
		props: {
			data: {
				locale: 'en',
				group: { groupId: 'g1', name: 'Filmnacht', role: 'member' },
				members,
				pool,
				drawn,
				newCounts: {},
				toRate: [],
				next,
				used,
				max: 3
			} as never,
			form: form as never
		}
	}).body;
}

describe('the pool', () => {
	it("links each film's title to its page", () => {
		expect(body([entry({})])).toMatch(/<a[^>]*href="\/groups\/g1\/films\/s1"[^>]*>\s*Dune\s*<\/a>/);
	});

	it('keeps the withdraw button outside the link and above it', () => {
		const html = body([entry({ mine: true })]);
		const link = html.match(/<a[^>]*href="\/groups\/g1\/films\/s1"[^>]*>[\s\S]*?<\/a>/)?.[0] ?? '';
		expect(link).not.toContain('<button');
		expect(html).toMatch(/<form[^>]*action="\?\/withdraw"[^>]*class="[^"]*z-10/);
		// Its own stacking context per tile: without it the z-10 dot would paint
		// over the sticky header and the phone dock while scrolling.
		expect(html).toMatch(/<li class="[^"]*\bisolate\b/);
	});

	it('lifts the poster on hover and on keyboard focus, without amber', () => {
		const html = body([entry({})]);
		const poster =
			html.match(
				/<div class="([^"]*)">\s*(?:<!--[^>]*-->\s*)*<(?:img|div)[^>]*aspect-\[2\/3\]/
			)?.[1] ?? '';
		expect(poster).toContain('group-hover/tile:shadow-md');
		expect(poster).toContain('group-hover/tile:ring-1');
		expect(poster).toContain('group-hover/tile:ring-base-content/50');
		expect(poster).toContain('group-has-[a:focus-visible]/tile:ring-base-content/50');
		expect(poster).toContain('group-has-[a:focus-visible]/tile:shadow-md');
		expect(poster).not.toMatch(/primary|warning|amber/);
		expect(html).toMatch(/<li class="[^"]*\bgroup\/tile\b/);
	});

	// WCAG 1.4.11: a visual cue needs 3:1 against what is next to it. The ring sits
	// just outside the poster, on the page background, and next to the poster's
	// edge, which can be pure white. Checked in both themes from app.css itself.
	it('keeps the hover ring at 3:1 or more in both themes, whatever the poster', () => {
		const html = body([entry({})]);
		const alpha = Number(html.match(/group-hover\/tile:ring-base-content\/(\d+)/)?.[1]) / 100;
		for (const theme of themes) {
			const page = token(theme, 'base-200');
			const ring = over(token(theme, 'base-content'), alpha, page);
			expect(ratio(ring, page)).toBeGreaterThanOrEqual(3);
			expect(ratio(ring, [255, 255, 255])).toBeGreaterThanOrEqual(3);
		}
	});

	it("marks the group's owner with the outlined badge the other info badges use", () => {
		const html = body([], [{ id: 'u1', displayName: 'Ada', role: 'owner' }]);
		expect(html).toMatch(/<span class="badge badge-outline">Owner<\/span>/);
	});

	// With a long German date the calendar icon shrank to a dot.
	it("keeps the next night's calendar icon full size beside a long date", () => {
		const next = {
			id: 'n1',
			when: 'Freitag, 6. November 2026 um 20:00',
			location: null,
			film: null,
			filmHidden: false,
			myResponse: null
		};
		const html = body([], [], next);
		expect(html).toMatch(/lucide-calendar-days[^"]*\bshrink-0\b/);
	});
});

describe('arriving from an invite to a group you are already in', () => {
	it('says you are already in it', () => {
		page.url = new URL('http://localhost/groups/g1?already');
		expect(body([])).toContain('You are already in this group');
		page.url = new URL('http://localhost/groups/g1');
		expect(body([])).not.toContain('You are already in this group');
	});
});

describe('with every suggestion used', () => {
	it('disables adding a film and says why', () => {
		const html = body([], [], null, 3);
		expect(html).not.toContain('href="/groups/g1/add"');
		expect(html).toMatch(/<button[^>]*disabled[^>]*>[\s\S]*?Add a film/);
		expect(html).toContain('All 3 suggestions used. Withdraw one to add another');
	});

	it('still offers it with a slot left', () => {
		const html = body([], [], null, 2);
		expect(html).toContain('href="/groups/g1/add"');
		expect(html).toContain('2 of 3 suggestions used');
	});
});

// The pool holds what can still be drawn, the films that count toward the
// limit. Drawn films get their own list below it.
describe('films already drawn', () => {
	const drawnOne = entry({
		suggestionId: 'd1',
		title: 'Heat',
		status: 'drawn',
		watchedOn: '30 October 2026'
	});

	it('are listed in their own section, after the pool', () => {
		const html = body([entry({})], [], null, 0, [drawnOne]);
		expect(html).toMatch(/<h2[^>]*>In the pool<\/h2>/);
		expect(html).toMatch(/<h2[^>]*>Drawn<\/h2>/);
		expect(html.indexOf('>In the pool<')).toBeLessThan(html.indexOf('films/s1'));
		expect(html.indexOf('films/s1')).toBeLessThan(html.indexOf('>Drawn<'));
		expect(html.indexOf('>Drawn<')).toBeLessThan(html.indexOf('films/d1'));
	});

	it('say when they were watched', () => {
		expect(body([], [], null, 0, [drawnOne])).toContain('Watched · 30 October 2026');
	});

	it('leave the empty pool saying so, with the history still below', () => {
		const html = body([], [], null, 0, [drawnOne]);
		expect(html).toContain('The pool is empty. Add the next film');
		expect(html).not.toContain('No films yet');
		expect(html).toContain('films/d1');
	});

	it('say so while nothing has been drawn', () => {
		expect(body([entry({})])).toContain('No film has been drawn yet');
	});
});

// One film a week is fifty tiles a year: the latest stay in view, the rest fold away.
describe('a long history of drawn films', () => {
	const drawnFilms = (n: number) =>
		Array.from({ length: n }, (_, i) =>
			entry({ suggestionId: `d${i}`, title: `Film ${i}`, status: 'drawn', watchedOn: 'x' })
		);
	const outsideDetails = (html: string) => html.replace(/<details[\s\S]*?<\/details>/g, '');

	it('shows the latest four and folds the rest away', () => {
		const html = body([], [], null, 0, drawnFilms(6));
		const shown = outsideDetails(html);
		for (const i of [0, 1, 2, 3]) expect(shown).toContain(`films/d${i}"`);
		for (const i of [4, 5]) {
			expect(shown).not.toContain(`films/d${i}"`);
			expect(html).toContain(`films/d${i}"`);
		}
		expect(html).toMatch(/<summary[^>]*>[\s\S]*Show 2 earlier films/);
	});

	it('folds nothing away with four or fewer', () => {
		expect(body([], [], null, 0, drawnFilms(4))).not.toContain('<details');
	});
});

// One list at a time: the pool, the drawn films and the members share the
// space under the next night, switched by links so a reload keeps the list.
describe('the list switch', () => {
	const members = [{ id: 'u1', displayName: 'Anna', role: 'owner' }];
	const panel = (html: string, label: string) =>
		html.match(
			new RegExp(`<(section|div)[^>]*>\\s*(?:<section[^>]*>\\s*)?<h2 id="list-${label}"`)
		)?.[0] ?? '';
	const isHidden = (html: string, label: string) =>
		/\bhidden\b/.test(panel(html, label).split('>')[0]);

	it('offers the three lists with their counts', () => {
		const html = body([entry({})], members, null, 0, [
			entry({ suggestionId: 'd1', status: 'drawn' })
		]);
		for (const [list, name, count] of [
			['pool', 'Pool', 1],
			['drawn', 'Drawn', 1],
			['members', 'Members', 1]
		]) {
			expect(html).toMatch(
				new RegExp(`<a[^>]*href="\\?list=${list}"[^>]*>\\s*${name}\\s*<span[^>]*>${count}</span>`)
			);
		}
	});

	it('shows the pool first and keeps the others out of view', () => {
		page.url = new URL('http://localhost/groups/g1');
		const html = body([entry({})], members);
		expect(isHidden(html, 'pool')).toBe(false);
		expect(isHidden(html, 'drawn')).toBe(true);
		expect(isHidden(html, 'members')).toBe(true);
		expect(html).toMatch(/<a[^>]*href="\?list=pool"[^>]*aria-current="page"/);
	});

	it('shows the list the address names', () => {
		page.url = new URL('http://localhost/groups/g1?list=drawn');
		const html = body([entry({})], members);
		expect(isHidden(html, 'drawn')).toBe(false);
		expect(isHidden(html, 'pool')).toBe(true);
		page.url = new URL('http://localhost/groups/g1');
	});

	// The invite link and the leave confirmation answer from the members list.
	it('stays on the members after creating an invite link', () => {
		const html = body([], members, null, 0, [], { inviteUrl: 'http://x/join/t' });
		expect(isHidden(html, 'members')).toBe(false);
	});

	it('comes back to the members after the first click on leave', () => {
		expect(body([], members)).toContain('action="?list=members&amp;/leave"');
	});
});

describe('answering the next night in place', () => {
	const next = {
		id: 'n1',
		when: 'Friday, 6 November 2026 at 20:00',
		location: null,
		status: 'scheduled',
		myResponse: 'maybe',
		film: null,
		filmHidden: false
	};

	it("sends the answer to the night's own action, marking the current one", () => {
		const html = body([], [], next);
		const form = html.match(
			/<form[^>]*action="\/groups\/g1\/nights\/n1\?\/respond"[\s\S]*?<\/form>/
		)?.[0];
		expect(form).toBeTruthy();
		for (const answer of ['yes', 'maybe', 'no']) expect(form).toContain(`value="${answer}"`);
		expect(form).toMatch(/value="maybe"[^>]*aria-pressed="true"/);
		expect(form).toMatch(/value="yes"[^>]*aria-pressed="false"/);
	});
});

// From the finish review: a compact card with one amber action per screen.
describe('the next night card, compact', () => {
	const next = (myResponse: string | null) => ({
		id: 'n1',
		when: 'Fri 6 Nov, 20:00',
		location: 'Bei Anna',
		status: 'scheduled',
		myResponse,
		film: null,
		filmHidden: false
	});
	const answerForm = (html: string) =>
		html.match(/<form[^>]*\?\/respond"[\s\S]*?<\/form>/)?.[0] ?? '';

	it('asks with short answers instead of a label above the title', () => {
		const html = body([], [], next(null));
		expect(html).not.toContain('>Next movie night<');
		expect(html).toContain('Are you coming?');
		const form = answerForm(html);
		for (const label of ['Yes', 'Maybe', 'No'])
			expect(form).toMatch(new RegExp(`>\\s*(<[^>]+>\\s*)*${label}\\s*<`));
	});

	it('marks the chosen answer without amber, so the primary stays the only amber', () => {
		const form = answerForm(body([], [], next('yes')));
		expect(form).not.toContain('btn-primary');
		expect(form).toMatch(/value="yes"[^>]*class="[^"]*tab-active/);
	});

	it('sets badges at 14px, never the 12px small size', () => {
		const html = body([entry({ mine: true })], [], next(null), 0, [
			entry({ suggestionId: 'd1', status: 'drawn', watchedOn: '24 Oct' })
		]);
		expect(html).toContain('Yours');
		expect(html).not.toContain('badge-sm');
	});
});

describe('a film tile in German', () => {
	it('gives the running time in German', () => {
		const html = render(Page, {
			props: {
				data: {
					locale: 'de',
					group: { groupId: 'g1', name: 'Kino', role: 'member' },
					members: [],
					pool: [entry({})],
					drawn: [],
					newCounts: {},
					toRate: [],
					next: null,
					used: 0,
					max: 3
				} as never,
				form: null
			}
		}).body;
		expect(html).toContain('2021 · 155 Min.');
		expect(body([entry({})])).toContain('2021 · 155 min');
	});
});

// "Film hinzufügen" did not fit beside the count on a German phone and dropped
// onto its own line. The count wraps inside its own column instead.
describe('the suggestion count row', () => {
	it('keeps the add button beside the count', () => {
		const html = body([entry({})]);
		const div = html.match(
			/<div class="([^"]*)">(?:\s|<!--[^>]*-->)*<p class="([^"]*)">\s*0 of 3 suggestions used/
		);
		expect(div).toBeTruthy();
		expect(div![1]).not.toMatch(/\bflex-wrap\b/);
		expect(div![2]).toMatch(/\bmin-w-0\b/);
	});
});
