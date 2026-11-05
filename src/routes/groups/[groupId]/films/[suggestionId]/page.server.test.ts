import { isHttpError } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { applyMigrations, createDb, type DB } from '$lib/server/db/client';
import { DEFAULT_GROUP_SETTINGS, groups } from '$lib/server/db/schema';
import { addMember, createGroup } from '$lib/server/groups';
import { drawForNight, scheduleNight } from '$lib/server/nights';
import { addSuggestion, withdrawSuggestion } from '$lib/server/suggestions';
import { createUser } from '$lib/server/users';
import type { MovieInput } from '$lib/server/movies';

let db: DB;
vi.mock('$lib/server/db', () => ({
	get db() {
		return db;
	}
}));
const filmDetails = vi.fn();
vi.mock('$lib/server/film-details', () => ({
	filmDetails: (...a: unknown[]) => filmDetails(...a)
}));

const { load } = await import('./+page.server');

let ada: string;
let grace: string;
let outsider: string;
let groupId: string;

const DUNE: MovieInput = {
	tmdbId: 438631,
	title: 'Dune',
	year: 2021,
	runtime: 155,
	genres: ['Science Fiction'],
	tmdbRating: 7.8
};
const DETAILS = { overview: 'A spice war.', directors: ['Denis Villeneuve'], cast: [] };

function suggest(movie: MovieInput, userId = grace, inGroup = groupId): string {
	const r = addSuggestion(db, {
		groupId: inGroup,
		userId,
		movie,
		settings: DEFAULT_GROUP_SETTINGS
	});
	if (!r.ok) throw new Error(r.reason);
	return r.suggestionId;
}

function open(userId: string, suggestionId: string) {
	return load({
		params: { groupId, suggestionId },
		locals: { user: { id: userId, displayName: 'x', isAdmin: false }, locale: 'de' }
	} as never) as Promise<Record<string, unknown>>;
}

async function status(p: Promise<unknown>): Promise<number | 'ok'> {
	try {
		await p;
		return 'ok';
	} catch (e) {
		if (isHttpError(e)) return e.status;
		throw e;
	}
}

beforeEach(() => {
	db = createDb(':memory:').db;
	applyMigrations(db);
	filmDetails.mockReset().mockResolvedValue(DETAILS);
	ada = createUser(db, { username: 'ada', displayName: 'Ada', passwordHash: 'x' }).id;
	grace = createUser(db, { username: 'grace', displayName: 'Grace', passwordHash: 'x' }).id;
	outsider = createUser(db, { username: 'out', displayName: 'Out', passwordHash: 'x' }).id;
	groupId = createGroup(db, { name: 'Filmnacht', ownerId: ada });
	addMember(db, grace, groupId);
});

describe('the film page', () => {
	it('shows a pooled film with its TMDB details to a member, in their language', async () => {
		const id = suggest(DUNE);
		const data = await open(ada, id);
		expect(data.film).toMatchObject({ title: 'Dune', year: 2021, runtime: 155, tmdbRating: 7.8 });
		expect(data.film).toMatchObject({ genres: ['Science Fiction'] });
		expect(data.details).toEqual(DETAILS);
		expect(data.tmdbUrl).toBe('https://www.themoviedb.org/movie/438631');
		expect(filmDetails).toHaveBeenCalledWith(438631, 'de');
	});

	it('never says who suggested it', async () => {
		const data = await open(ada, suggest(DUNE));
		expect(JSON.stringify(data)).not.toContain(grace);
		expect(JSON.stringify(data)).not.toContain('Grace');
	});

	it('404s for a non-member', async () => {
		expect(await status(open(outsider, suggest(DUNE)))).toBe(404);
	});

	it('404s for a withdrawn suggestion and for one from another group', async () => {
		const id = suggest(DUNE);
		withdrawSuggestion(db, grace, id);
		expect(await status(open(ada, id))).toBe(404);

		const other = createGroup(db, { name: 'Other', ownerId: outsider });
		const foreign = suggest({ title: 'Arrival' }, outsider, other);
		expect(await status(open(ada, foreign))).toBe(404);
	});

	it('404s for a film drawn for an upcoming surprise night', async () => {
		const id = suggest(DUNE);
		db.update(groups)
			.set({ settings: { ...DEFAULT_GROUP_SETTINGS, resultVisible: 'on_night' } })
			.where(eq(groups.id, groupId))
			.run();
		const night = scheduleNight(db, {
			groupId,
			userId: ada,
			scheduledAt: new Date(Date.now() + 86_400_000),
			location: null
		});
		drawForNight(db, night, ada);
		expect(await status(open(ada, id))).toBe(404);
	});

	it('tells a member whose film has gone apart from an outsider, who learns nothing', async () => {
		const message = async (run: Promise<unknown>) => {
			try {
				await run;
			} catch (e) {
				return (e as { body: { message: string } }).body.message;
			}
		};
		const id = suggest(DUNE);
		const outsiderSees = await message(open(outsider, id));
		expect(await message(open(outsider, crypto.randomUUID()))).toBe(outsiderSees);
		expect(outsiderSees).not.toBe('gone');
		expect(await message(open(ada, crypto.randomUUID()))).toBe('gone');
	});

	describe('signed out, as a link preview reads it', () => {
		const signedOut = (suggestionId: string, inGroup = groupId) =>
			load({
				params: { groupId: inGroup, suggestionId },
				locals: { user: null, locale: 'en' }
			} as never);

		it('gives the film’s title and poster, and nothing else', async () => {
			const id = suggest({ ...DUNE, posterUrl: 'https://img/dune.jpg' });
			expect(await signedOut(id)).toEqual({
				preview: { title: 'Dune (2021)', image: 'https://img/dune.jpg' }
			});
		});

		it('gives nothing for an unknown film, or one from another group', async () => {
			expect(await signedOut(crypto.randomUUID())).toEqual({ preview: null });
			expect(await signedOut(suggest(DUNE), crypto.randomUUID())).toEqual({ preview: null });
			const other = createGroup(db, { name: 'Other', ownerId: outsider });
			const foreign = suggest({ title: 'Arrival' }, outsider, other);
			expect(await signedOut(foreign)).toEqual({ preview: null });
		});

		it('gives nothing for a withdrawn film', async () => {
			const id = suggest(DUNE);
			withdrawSuggestion(db, grace, id);
			expect(await signedOut(id)).toEqual({ preview: null });
		});

		it('keeps a surprise: nothing for a film drawn for a night still to come', async () => {
			const id = suggest(DUNE);
			db.update(groups)
				.set({ settings: { ...DEFAULT_GROUP_SETTINGS, resultVisible: 'on_night' } })
				.where(eq(groups.id, groupId))
				.run();
			const night = scheduleNight(db, {
				groupId,
				userId: ada,
				scheduledAt: new Date(Date.now() + 86_400_000),
				location: null
			});
			drawForNight(db, night, ada);
			expect(await signedOut(id)).toEqual({ preview: null });
		});
	});

	it('renders a hand-entered film without asking TMDB', async () => {
		const data = await open(ada, suggest({ title: 'Home video' }));
		expect(data.film).toMatchObject({ title: 'Home video', tmdbId: null });
		expect(data.details).toBeNull();
		expect(data.tmdbUrl).toBeNull();
		expect(filmDetails).not.toHaveBeenCalled();
	});

	it('still renders when TMDB has nothing', async () => {
		filmDetails.mockResolvedValue(null);
		const data = await open(ada, suggest(DUNE));
		expect(data.film).toMatchObject({ title: 'Dune' });
		expect(data.details).toBeNull();
	});
});
