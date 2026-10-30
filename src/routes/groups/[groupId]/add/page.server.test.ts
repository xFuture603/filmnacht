import type { HttpError } from '@sveltejs/kit';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mocked before the SUT import so `+page.server.ts`'s `import { db } from
// '$lib/server/db'` resolves to an in-memory database instead of ever
// touching the real singleton (which would create data/filmnacht.db as a
// side effect of running the test suite).
vi.mock('$lib/server/db', async () => {
	const { createDb, applyMigrations } = await import('../../../../lib/server/db/client');
	const { db } = createDb(':memory:');
	applyMigrations(db);
	return { db };
});

// fetchMovie is the outbound TMDB call. Spying on it, rather than on fetch
// itself, is what lets the test assert "never called" directly against the
// same import the route action uses.
vi.mock('$lib/server/tmdb', async (importOriginal) => {
	const actual = await importOriginal<typeof import('$lib/server/tmdb')>();
	return { ...actual, fetchMovie: vi.fn() };
});

const { db } = await import('$lib/server/db');
const { fetchMovie } = await import('$lib/server/tmdb');
const { createGroup } = await import('../../../../lib/server/groups');
const { createUser } = await import('../../../../lib/server/users');
const { actions, load } = await import('./+page.server');
const { addSuggestion } = await import('../../../../lib/server/suggestions');
const { DEFAULT_GROUP_SETTINGS } = await import('../../../../lib/server/db/schema');

function formRequest(fields: Record<string, string>) {
	const form = new FormData();
	for (const [k, v] of Object.entries(fields)) form.append(k, v);
	return new Request('http://localhost/irrelevant', { method: 'POST', body: form });
}

let ownerId: string;
let outsiderId: string;
let groupId: string;

beforeEach(() => {
	vi.mocked(fetchMovie).mockReset();
	ownerId = createUser(db, {
		username: `ada${Math.random()}`.replace('.', ''),
		displayName: 'Ada',
		passwordHash: 'scrypt$placeholder$placeholder'
	}).id;
	outsiderId = createUser(db, {
		username: `grace${Math.random()}`.replace('.', ''),
		displayName: 'Grace',
		passwordHash: 'scrypt$placeholder$placeholder'
	}).id;
	groupId = createGroup(db, { name: 'Movie Club', ownerId });
	// Grace is deliberately never added as a member of this group.
});

describe('adopt action — authorization happens before the outbound call', () => {
	it('404s a signed-in non-member without ever calling TMDB', async () => {
		const request = formRequest({ tmdbId: '438631' });
		const locals = { user: { id: outsiderId, displayName: 'Grace', isAdmin: false }, locale: 'en' };

		let caught: HttpError | undefined;
		try {
			// @ts-expect-error - only the fields the action reads are supplied
			await actions.adopt({ request, locals, params: { groupId } });
		} catch (error) {
			caught = error as HttpError;
		}

		expect(caught?.status).toBe(404);
		expect(fetchMovie).not.toHaveBeenCalled();
	});
});

describe('the add page load', () => {
	const run = () =>
		load({
			params: { groupId },
			locals: { user: { id: ownerId, displayName: 'Ada', isAdmin: false }, locale: 'en' }
		} as never) as { taken: number[]; capped: boolean };
	const settings = DEFAULT_GROUP_SETTINGS;

	it('says which TMDB films are already suggested', () => {
		const movie = { tmdbId: 438631, title: 'Dune' };
		addSuggestion(db, { groupId, userId: ownerId, movie, settings });
		expect(run().taken).toEqual([438631]);
	});

	it('says when your suggestions are used up', () => {
		expect(run().capped).toBe(false);
		for (let i = 1; i <= settings.maxOpenSuggestions; i++) {
			addSuggestion(db, {
				groupId,
				userId: ownerId,
				movie: { tmdbId: i, title: `F${i}` },
				settings
			});
		}
		expect(run().capped).toBe(true);
	});
});
