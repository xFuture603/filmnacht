import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { applyMigrations, createDb, type DB } from '$lib/server/db/client';
import { DEFAULT_GROUP_SETTINGS, groups, movieNights } from '$lib/server/db/schema';
import { addMember, createGroup } from '$lib/server/groups';
import { drawForNight, scheduleNight } from '$lib/server/nights';
import { addSuggestion } from '$lib/server/suggestions';
import { createUser } from '$lib/server/users';

let db: DB;
let ada: string; // owner
let grace: string;
let alan: string;
let mallory: string; // outside the group
let groupId: string;
let nightId: string;

// A fresh database per test; the route's `import { db }` reads through the getter.
vi.mock('$lib/server/db', () => ({
	get db() {
		return db;
	}
}));

const { load, actions } = await import('./+page.server');

function person(username: string) {
	return createUser(db, {
		username,
		displayName: username[0].toUpperCase() + username.slice(1),
		passwordHash: 'scrypt$placeholder$placeholder'
	}).id;
}

function locals(userId: string) {
	return { user: { id: userId, displayName: 'x', isAdmin: false }, locale: 'en' as const };
}

type Data = Exclude<Awaited<ReturnType<typeof load>>, void>;

async function view(userId: string, params = { groupId, nightId }): Promise<Data> {
	return (await load({ params, locals: locals(userId) } as never)) as Data;
}

async function post(
	action: keyof typeof actions,
	userId: string,
	fields: Record<string, string> = {},
	params = { groupId, nightId }
) {
	return actions[action]({
		params,
		locals: locals(userId),
		request: new Request('http://localhost/x', {
			method: 'POST',
			body: new URLSearchParams(fields)
		})
	} as never);
}

/** The HTTP status a SvelteKit `error()` carried, or 'no throw'. */
async function statusOf(fn: () => unknown): Promise<number | 'no throw'> {
	try {
		await fn();
		return 'no throw';
	} catch (e) {
		return (e as { status: number }).status;
	}
}

beforeEach(() => {
	db = createDb(':memory:').db;
	applyMigrations(db);
	ada = person('ada');
	grace = person('grace');
	alan = person('alan');
	mallory = person('mallory');
	groupId = createGroup(db, { name: 'Filmnacht', ownerId: ada });
	addMember(db, grace, groupId);
	addMember(db, alan, groupId);
	addSuggestion(db, {
		groupId,
		userId: grace,
		movie: { title: 'Dune' },
		settings: DEFAULT_GROUP_SETTINGS
	});
	// Four hours ago: the default 3-hour night has ended, so the window is
	// open. scheduleNight has no past check at the library level.
	nightId = scheduleNight(db, {
		groupId,
		userId: ada,
		scheduledAt: new Date(Date.now() - 4 * 60 * 60 * 1000),
		location: null
	});
	drawForNight(db, nightId, ada);
});

describe('rating', () => {
	it('shows nobody else’s score or comment in the payload before the reveal', async () => {
		await post('rate', grace, { score: '7', comment: 'grace-secret' });
		await post('rate', alan, { score: '3' });
		const data = await view(alan);
		expect(JSON.stringify(data)).not.toContain('grace-secret');
		expect(data.ratings.results).toBeNull();
		expect(data.ratings.mine).toEqual({ score: 3, comment: null });
	});

	it('reports a closed window for a never-rater, not "open"', async () => {
		// 8 days before "now": well past the default 3h + 7d window.
		db.update(movieNights)
			.set({ scheduledAt: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000) })
			.where(eq(movieNights.id, nightId))
			.run();
		const data = await view(alan); // alan never rated this night
		expect(data.ratings.window.state).toBe('closed');
		expect(data.ratings.mine).toBeNull();
	});

	it('refuses to rate before the night has ended, and shows no rating card', async () => {
		db.update(movieNights)
			.set({ scheduledAt: new Date(Date.now() + 60 * 60 * 1000) })
			.where(eq(movieNights.id, nightId))
			.run();
		expect(await post('rate', grace, { score: '7' })).toMatchObject({
			status: 400,
			data: { error: 'ratings.error.window' }
		});
		expect((await view(grace)).ratings.window.state).toBe('before');
	});

	it('lets members rate at once when the owner marks the night watched early', async () => {
		db.update(movieNights)
			.set({ scheduledAt: new Date(Date.now() + 24 * 60 * 60 * 1000) })
			.where(eq(movieNights.id, nightId))
			.run();
		await post('markWatched', ada, { confirm: 'on' });
		expect((await view(grace)).ratings.window.state).toBe('open');
		expect(await post('rate', grace, { score: '7' })).not.toMatchObject({ status: 400 });
	});

	it('names a surprise film once the owner marks the night watched early', async () => {
		db.update(groups)
			.set({ settings: { ...DEFAULT_GROUP_SETTINGS, resultVisible: 'on_night' } })
			.where(eq(groups.id, groupId))
			.run();
		db.update(movieNights)
			.set({ scheduledAt: new Date(Date.now() + 24 * 60 * 60 * 1000) })
			.where(eq(movieNights.id, nightId))
			.run();
		expect((await view(grace)).film).toBeNull();
		await post('markWatched', ada, { confirm: 'on' });
		expect((await view(grace)).film?.title).toBeTruthy();
	});

	it('refuses a score that is not a half step from 1 to 10', async () => {
		expect(await post('rate', grace, { score: '7.25' })).toMatchObject({
			status: 400,
			data: { error: 'ratings.error.score' }
		});
	});

	it('lets only the owner reveal, and only on the second click', async () => {
		await post('rate', grace, { score: '7' });
		expect(await statusOf(() => post('reveal', grace, { confirm: 'on' }))).toBe(403);
		expect(await statusOf(() => post('reveal', mallory, { confirm: 'on' }))).toBe(404);
		expect(await post('reveal', ada, {})).toMatchObject({
			status: 400,
			data: { confirm: 'reveal' }
		});
		expect(await post('reveal', ada, { confirm: 'on' })).toEqual({ revealed: true });
		expect((await view(alan)).ratings.results?.average).toBe(7);
	});

	it('refuses every rating action to somebody outside the group with 404', async () => {
		for (const action of ['rate', 'withdrawRating', 'reveal'] as const) {
			expect(await statusOf(() => post(action, mallory, { score: '7', confirm: 'on' }))).toBe(404);
		}
	});

	it('shows a revealed night’s average on the nights list', async () => {
		await post('rate', grace, { score: '8' });
		await post('reveal', ada, { confirm: 'on' });
		const { load: listLoad } = await import('../+page.server');
		const list = (await listLoad({
			params: { groupId },
			locals: locals(grace),
			url: new URL('http://x/')
		} as never)) as {
			past: Array<{ id: string; average: number | null }>;
		};
		expect(list.past.find((n) => n.id === nightId)?.average).toBe(8);
	});
});
