import type { HttpError } from '@sveltejs/kit';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$lib/server/db', async () => {
	const { createDb, applyMigrations } = await import('../../../../../lib/server/db/client');
	const { db } = createDb(':memory:');
	applyMigrations(db);
	return { db };
});

vi.mock('$lib/server/tmdb', async (importOriginal) => {
	const actual = await importOriginal<typeof import('$lib/server/tmdb')>();
	return { ...actual, searchMovies: vi.fn() };
});

const env = vi.hoisted(() => ({ TMDB_API_KEY: 'KEY' as string | undefined }));
vi.mock('$env/dynamic/private', () => ({ env }));

const { db } = await import('$lib/server/db');
const { searchMovies } = await import('$lib/server/tmdb');
const { createGroup } = await import('../../../../../lib/server/groups');
const { createUser } = await import('../../../../../lib/server/users');
const { GET } = await import('./+server');

let memberId: string;
let outsiderId: string;
let groupId: string;

const user = (username: string) =>
	createUser(db, { username, displayName: username, passwordHash: 'scrypt$x$x' }).id;

beforeEach(() => {
	vi.mocked(searchMovies).mockReset();
	env.TMDB_API_KEY = 'KEY';
	memberId = user(`ada${Math.random()}`.replace('.', ''));
	outsiderId = user(`grace${Math.random()}`.replace('.', ''));
	groupId = createGroup(db, { name: 'Movie Club', ownerId: memberId });
});

function search(userId: string, q: string) {
	return GET({
		url: new URL(`http://localhost/groups/${groupId}/add/search?q=${encodeURIComponent(q)}`),
		params: { groupId },
		locals: { user: { id: userId, displayName: 'x', isAdmin: false }, locale: 'en' }
	} as never);
}

async function statusOf(fn: () => unknown) {
	try {
		await fn();
		return 'no throw';
	} catch (error) {
		return (error as HttpError).status;
	}
}

const dune = { tmdbId: 438631, title: 'Dune', year: 2021, posterUrl: null, tmdbRating: 7.8 };

describe('the live search endpoint', () => {
	it("returns TMDB's results for a member", async () => {
		vi.mocked(searchMovies).mockResolvedValue([dune]);
		const response = await search(memberId, 'dune');
		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({ results: [dune] });
		expect(vi.mocked(searchMovies).mock.calls[0].slice(0, 2)).toEqual(['KEY', 'dune']);
	});

	// A non-member must not be able to make this instance call TMDB for them.
	it('404s a non-member without calling TMDB', async () => {
		expect(await statusOf(() => search(outsiderId, 'dune'))).toBe(404);
		expect(searchMovies).not.toHaveBeenCalled();
	});

	it('answers a query under two characters with no results, without calling TMDB', async () => {
		const response = await search(memberId, ' d ');
		expect(await response.json()).toEqual({ results: [] });
		expect(searchMovies).not.toHaveBeenCalled();
	});

	it('503s when the instance has no TMDB key', async () => {
		env.TMDB_API_KEY = undefined;
		expect(await statusOf(() => search(memberId, 'dune'))).toBe(503);
	});

	it('502s when TMDB fails, never passing its error on', async () => {
		vi.mocked(searchMovies).mockRejectedValue(new Error('TMDB search failed: 500'));
		expect(await statusOf(() => search(memberId, 'dune'))).toBe(502);
	});
});
