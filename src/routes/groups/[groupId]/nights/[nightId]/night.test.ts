import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { applyMigrations, createDb, type DB } from '$lib/server/db/client';
import { DEFAULT_GROUP_SETTINGS, groups, movieNights } from '$lib/server/db/schema';
import { addMember, createGroup } from '$lib/server/groups';
import { drawForNight, nightDetail, scheduleNight } from '$lib/server/nights';
import { addSuggestion } from '$lib/server/suggestions';
import { createUser } from '$lib/server/users';

let db: DB;
let ada: string;
let grace: string;
let mallory: string;
let groupId: string;
let nightId: string;

// A fresh database per test; the route's `import { db }` reads through the getter.
vi.mock('$lib/server/db', () => ({
	get db() {
		return db;
	}
}));

const { load, actions } = await import('./+page.server');

const LATER = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

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

function setResultVisible(value: 'immediately' | 'on_night') {
	db.update(groups)
		.set({ settings: { ...DEFAULT_GROUP_SETTINGS, resultVisible: value } })
		.where(eq(groups.id, groupId))
		.run();
}

beforeEach(() => {
	db = createDb(':memory:').db;
	applyMigrations(db);
	ada = person('ada');
	grace = person('grace');
	mallory = person('mallory');
	groupId = createGroup(db, { name: 'Filmnacht', ownerId: ada });
	addMember(db, grace, groupId);
	addSuggestion(db, {
		groupId,
		userId: grace,
		movie: { title: 'Dune' },
		settings: DEFAULT_GROUP_SETTINGS
	});
	nightId = scheduleNight(db, { groupId, userId: ada, scheduledAt: LATER, location: null });
	drawForNight(db, nightId, ada);
});

describe('the drawn title and resultVisible', () => {
	it('includes it immediately by default', async () => {
		const data = await view(grace);
		expect(data.film?.title).toBe('Dune');
		expect(data.film?.by).toBe('Grace');
	});

	it('withholds it from the payload until the night, when set to on_night', async () => {
		// Not an {#if} in the markup: a title present in `data` is readable in the
		// page source, and the group was told the film was a surprise.
		setResultVisible('on_night');
		const data = await view(grace);
		expect(JSON.stringify(data)).not.toContain('Dune');
		expect(JSON.stringify(data)).not.toContain('Grace');
		expect(data.filmHidden).toBe(true);
	});

	it('withholds it from the owner too', async () => {
		setResultVisible('on_night');
		expect(JSON.stringify(await view(ada))).not.toContain('Dune');
	});

	it('includes it once the night has started', async () => {
		setResultVisible('on_night');
		db.update(movieNights)
			.set({ scheduledAt: new Date(Date.now() - 60_000) })
			.where(eq(movieNights.id, nightId))
			.run();
		expect((await view(grace)).film?.title).toBe('Dune');
	});
});

describe('who may see a night', () => {
	it('gives a non-member the same 404 as a night that does not exist', async () => {
		expect(await statusOf(() => view(mallory))).toBe(404);
		expect(await statusOf(() => view(ada, { groupId, nightId: 'no-such-night' }))).toBe(404);
	});

	it('404s a night reached through another group’s URL', async () => {
		const other = createGroup(db, { name: 'Elsewhere', ownerId: ada });
		expect(await statusOf(() => view(ada, { groupId: other, nightId }))).toBe(404);
		expect(await statusOf(() => post('cancel', ada, {}, { groupId: other, nightId }))).toBe(404);
		// And the night was left alone.
		expect(nightDetail(db, nightId, ada)?.status).toBe('drawn');
	});
});

describe('who may act on a night', () => {
	it('refuses every owner action to a member, with 403', async () => {
		for (const action of ['draw', 'redraw', 'cancel', 'markWatched'] as const) {
			expect(await statusOf(() => post(action, grace, { reason: 'x' }))).toBe(403);
		}
		expect(nightDetail(db, nightId, ada)?.status).toBe('drawn');
	});

	it('refuses every action to a non-member, with 404', async () => {
		for (const action of ['respond', 'draw', 'redraw', 'cancel', 'markWatched'] as const) {
			expect(await statusOf(() => post(action, mallory, { response: 'yes', reason: 'x' }))).toBe(
				404
			);
		}
	});

	it('lets any member answer', async () => {
		await post('respond', grace, { response: 'maybe' });
		expect(nightDetail(db, nightId, grace)?.myResponse).toBe('maybe');
	});

	it('refuses an answer the page does not offer', async () => {
		const result = await post('respond', grace, { response: 'definitely' });
		expect(result).toMatchObject({ status: 400, data: { error: 'night.error.response' } });
	});

	it('lets the owner mark the night watched', async () => {
		expect(await post('markWatched', ada)).toEqual({ watched: true });
		expect(nightDetail(db, nightId, ada)?.status).toBe('watched');
	});

	it('requires a reason to draw again', async () => {
		const result = await post('redraw', ada, { reason: '   ' });
		expect(result).toMatchObject({ status: 400, data: { error: 'night.error.reason' } });
	});

	it('says plainly why a one-film pool cannot be drawn again', async () => {
		const result = await post('redraw', ada, { reason: 'seen it' });
		expect(result).toMatchObject({ status: 400, data: { error: 'night.error.sole_suggestion' } });
	});
});
