import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { applyMigrations, createDb, type DB } from '$lib/server/db/client';
import { DEFAULT_GROUP_SETTINGS, groups, memberships, movieNights } from '$lib/server/db/schema';
import { addMember, createGroup, listGroupsFor } from '$lib/server/groups';
import { drawForNight, markWatched, scheduleNight } from '$lib/server/nights';
import { saveRating } from '$lib/server/ratings';
import { addSuggestion, type PoolEntry } from '$lib/server/suggestions';
import { createUser } from '$lib/server/users';

let db: DB;
let ada: string;
let grace: string;
let groupId: string;

vi.mock('$lib/server/db', () => ({
	get db() {
		return db;
	}
}));

const { load, actions } = await import('./+page.server');

type Data = Exclude<Awaited<ReturnType<typeof load>>, void>;

async function poolFor(userId: string): Promise<Data> {
	return (await load({
		params: { groupId },
		locals: { user: { id: userId, displayName: 'x', isAdmin: false }, locale: 'en' }
	} as never)) as Data;
}

beforeEach(() => {
	db = createDb(':memory:').db;
	applyMigrations(db);
	ada = createUser(db, { username: 'ada', displayName: 'Ada', passwordHash: 'x' }).id;
	grace = createUser(db, { username: 'grace', displayName: 'Grace', passwordHash: 'x' }).id;
	groupId = createGroup(db, { name: 'Filmnacht', ownerId: ada });
	addMember(db, grace, groupId);
	for (const title of ['Dune', 'Arrival']) {
		addSuggestion(db, {
			groupId,
			userId: grace,
			movie: { title },
			settings: DEFAULT_GROUP_SETTINGS
		});
	}
	const night = scheduleNight(db, {
		groupId,
		userId: ada,
		scheduledAt: new Date(Date.now() + 86_400_000),
		location: null
	});
	drawForNight(db, night, ada);
});

describe('the pool and a surprise draw', () => {
	it('shows the drawn film, badged, when the group reveals immediately', async () => {
		const pool = (await poolFor(ada)).pool;
		expect(pool).toHaveLength(2);
		expect(pool.filter((e: PoolEntry) => e.status === 'drawn')).toHaveLength(1);
	});

	it('leaves the drawn film out until the night when the group keeps it a surprise', async () => {
		// The night page withholds the title; a "drawn" badge in the pool would
		// give the same secret away.
		db.update(groups)
			.set({ settings: { ...DEFAULT_GROUP_SETTINGS, resultVisible: 'on_night' } })
			.where(eq(groups.id, groupId))
			.run();
		const pool = (await poolFor(ada)).pool;
		expect(pool).toHaveLength(1);
		expect(pool.every((e: PoolEntry) => e.status === 'open')).toBe(true);
	});
});

describe('new films', () => {
	beforeEach(() => {
		// The beforeEach above adds the films in the same second as the joins.
		// Move the joins back so those films count as new.
		db.update(memberships)
			.set({ joinedAt: new Date(Date.now() - 3_600_000) })
			.run();
	});

	it("badges other members' open films once, never a drawn one", async () => {
		const first = await poolFor(ada);
		const isNew = (e: PoolEntry & { isNew: boolean }) => e.isNew;
		expect(first.pool.filter(isNew)).toHaveLength(1);
		expect(first.pool.find(isNew)?.status).toBe('open');
		expect(first.newCounts.pool).toBe(0);
		expect((await poolFor(ada)).pool.filter(isNew)).toHaveLength(0);
	});

	it('refuses a non-member before marking anything as seen', async () => {
		const lin = createUser(db, { username: 'lin', displayName: 'Lin', passwordHash: 'x' }).id;
		await expect(poolFor(lin)).rejects.toMatchObject({ status: 404 });
	});
});

describe('the next night card', () => {
	it('names the drawn film when the group reveals immediately', async () => {
		const next = (await poolFor(grace)).next;
		expect(next?.status).toBe('drawn');
		expect(['Dune', 'Arrival']).toContain(next?.film?.title);
	});

	it('keeps a surprise film out of the page data, not just off the screen', async () => {
		db.update(groups)
			.set({ settings: { ...DEFAULT_GROUP_SETTINGS, resultVisible: 'on_night' } })
			.where(eq(groups.id, groupId))
			.run();
		const next = (await poolFor(grace)).next;
		expect(next?.filmHidden).toBe(true);
		expect(JSON.stringify(next)).not.toMatch(/Dune|Arrival/);
	});
});

describe('the label on a drawn film', () => {
	type Entry = Data['pool'][number];
	const drawnEntry = async () =>
		(await poolFor(grace)).pool.find((e: Entry) => e.status === 'drawn') as Entry;

	it('says when it is on, while its night is still to come', async () => {
		const entry = await drawnEntry();
		expect(entry.night?.watched).toBe(false);
		expect(entry.drawnFor).toBeTruthy();
	});

	it('says watched only once its night is marked watched', async () => {
		const night = db
			.select({ id: movieNights.id })
			.from(movieNights)
			.where(eq(movieNights.groupId, groupId))
			.get()!;
		markWatched(db, night.id, ada);
		const entry = await drawnEntry();
		expect(entry.night?.watched).toBe(true);
		expect(entry.drawnFor).toBeNull();
	});
});

describe('the rating card', () => {
	beforeEach(() => {
		db.update(movieNights)
			.set({ scheduledAt: new Date(Date.now() - 5 * 3_600_000) })
			.where(eq(movieNights.groupId, groupId))
			.run();
	});

	it('asks a member who has not rated, and goes away once they have', async () => {
		const first = (await poolFor(grace)).toRate;
		expect(first).toHaveLength(1);
		expect(['Dune', 'Arrival']).toContain(first[0].title);
		expect(first[0].closes).toBeTruthy();
		saveRating(db, {
			nightId: first[0].id,
			userId: grace,
			scoreX2: 14,
			comment: null,
			now: new Date()
		});
		expect((await poolFor(grace)).toRate).toEqual([]);
	});
});

describe('leaving the group', () => {
	async function leave(userId: string, fields: Record<string, string>) {
		try {
			return await actions.leave({
				params: { groupId },
				locals: { user: { id: userId, displayName: 'x', isAdmin: false }, locale: 'en' },
				request: new Request('http://localhost/x', {
					method: 'POST',
					body: new URLSearchParams(fields)
				})
			} as never);
		} catch (e) {
			return e as { status: number; location?: string };
		}
	}

	it('lets a member leave, and keeps their films in the pool', async () => {
		const before = (await poolFor(ada)).pool.length;
		expect(await leave(grace, { confirm: 'on' })).toMatchObject({
			status: 303,
			location: '/groups'
		});
		expect(listGroupsFor(db, grace)).toEqual([]);
		expect((await poolFor(ada)).pool.length).toBe(before);
	});

	it('refuses without the confirming tick', async () => {
		expect(await leave(grace, {})).toMatchObject({
			status: 400,
			data: { error: 'groups.error.confirm' }
		});
		expect(listGroupsFor(db, grace)).toHaveLength(1);
	});

	it('never lets the owner leave', async () => {
		expect(await leave(ada, { confirm: 'on' })).toMatchObject({
			status: 400,
			data: { error: 'groups.error.owner_leave' }
		});
		expect(listGroupsFor(db, ada)).toHaveLength(1);
	});
});
