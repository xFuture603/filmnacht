import { isHttpError } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { applyMigrations, createDb, type DB } from '$lib/server/db/client';
import { DEFAULT_GROUP_SETTINGS, groups } from '$lib/server/db/schema';
import { createGroup } from '$lib/server/groups';
import { addSuggestion } from '$lib/server/suggestions';
import { createUser } from '$lib/server/users';

let db: DB;
vi.mock('$lib/server/db', () => ({
	get db() {
		return db;
	}
}));
const tmdbFilm = vi.fn();
const filmDetails = vi.fn();
vi.mock('$lib/server/film-details', () => ({
	tmdbFilm: (...a: unknown[]) => tmdbFilm(...a),
	filmDetails: (...a: unknown[]) => filmDetails(...a)
}));

const { load } = await import('./+page.server');

const DUNE = {
	tmdbId: 438631,
	title: 'Dune',
	year: 2021,
	posterUrl: 'https://img/dune.jpg',
	tmdbRating: 7.8,
	runtime: 155,
	genres: ['Science Fiction']
};
let ada: string;
let outsider: string;
let groupId: string;

const open = (userId: string | null, tmdbId = '438631', group = groupId) =>
	load({
		params: { groupId: group, tmdbId },
		locals: {
			user: userId ? { id: userId, displayName: 'x', isAdmin: false } : null,
			locale: 'de'
		}
	} as never) as Promise<Record<string, unknown>>;

const failure = (run: Promise<unknown>) =>
	run.then(
		() => 'ok',
		(e) => (isHttpError(e) ? [e.status, e.body.message] : Promise.reject(e))
	);

beforeEach(() => {
	db = createDb(':memory:').db;
	applyMigrations(db);
	tmdbFilm.mockReset().mockResolvedValue(DUNE);
	filmDetails.mockReset().mockResolvedValue({ overview: 'Spice.', directors: [], cast: [] });
	ada = createUser(db, { username: 'ada', displayName: 'Ada', passwordHash: 'x' }).id;
	outsider = createUser(db, { username: 'out', displayName: 'Out', passwordHash: 'x' }).id;
	groupId = createGroup(db, { name: 'Filmclub', ownerId: ada });
});

describe('a film from the search, not in the pool yet', () => {
	it('shows a member the film, its details and that it can be added', async () => {
		expect(await open(ada)).toMatchObject({
			film: DUNE,
			details: { overview: 'Spice.' },
			tmdbUrl: 'https://www.themoviedb.org/movie/438631',
			taken: false,
			capped: false
		});
		expect(filmDetails).toHaveBeenCalledWith(438631, 'de');
	});

	it('says when the film is already suggested', async () => {
		addSuggestion(db, { groupId, userId: ada, movie: DUNE, settings: DEFAULT_GROUP_SETTINGS });
		expect(await open(ada)).toMatchObject({ taken: true });
	});

	it('says when the member is at their limit', async () => {
		addSuggestion(db, {
			groupId,
			userId: ada,
			movie: { title: 'Heat' },
			settings: DEFAULT_GROUP_SETTINGS
		});
		db.update(groups)
			.set({ settings: { ...DEFAULT_GROUP_SETTINGS, maxOpenSuggestions: 1 } })
			.where(eq(groups.id, groupId))
			.run();
		expect(await open(ada)).toMatchObject({ taken: false, capped: true });
	});

	it('tells a member about an unknown film as gone', async () => {
		tmdbFilm.mockResolvedValue(null);
		expect(await failure(open(ada))).toEqual([404, 'gone']);
		expect(await failure(open(ada, 'abc'))).toEqual([404, 'gone']);
	});

	it('never calls TMDB for a signed-in non-member', async () => {
		const seen = await failure(open(outsider));
		expect(seen).toEqual([404, 'Not found']);
		expect(tmdbFilm).not.toHaveBeenCalled();
	});
});

describe('signed out, as a link preview reads it', () => {
	it('gives the title and poster, and nothing else', async () => {
		const data = await open(null);
		expect(Object.keys(data).sort()).toEqual(['preview', 'question']);
		expect(data.preview).toEqual({ title: 'Dune (2021)', image: 'https://img/dune.jpg' });
		expect(JSON.stringify(data)).not.toContain('Filmclub');
		expect(filmDetails).not.toHaveBeenCalled();
	});

	it('makes no TMDB call for a group that does not exist, or a malformed id', async () => {
		expect(await open(null, '438631', crypto.randomUUID())).toMatchObject({ preview: null });
		for (const bad of ['abc', '0', '-1', '1e3', '1/../2', '12345678901']) {
			expect(await open(null, bad)).toMatchObject({ preview: null });
		}
		expect(tmdbFilm).not.toHaveBeenCalled();
	});

	it('gives no preview for a film TMDB does not know', async () => {
		tmdbFilm.mockResolvedValue(null);
		expect(await open(null)).toMatchObject({ preview: null });
	});

	it('caps the lookups', async () => {
		await open(null);
		const { mayLookUp } = tmdbFilm.mock.calls[0][1];
		const answers = Array.from({ length: 40 }, () => mayLookUp());
		expect(answers.filter(Boolean).length).toBeLessThanOrEqual(30);
		expect(answers.at(-1)).toBe(false);
	});
});
