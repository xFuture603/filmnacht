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
const { actions } = await import('./+page.server');

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
	ownerId = createUser(db, 'Ada').id;
	outsiderId = createUser(db, 'Grace').id;
	groupId = createGroup(db, { name: 'Movie Club', ownerId });
	// Grace is deliberately never added as a member of this group.
});

describe('adopt action — authorization happens before the outbound call', () => {
	it('404s a signed-in non-member without ever calling TMDB', async () => {
		const request = formRequest({ tmdbId: '438631', note: '' });
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
