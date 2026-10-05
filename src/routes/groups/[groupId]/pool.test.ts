import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { applyMigrations, createDb, type DB } from '$lib/server/db/client';
import { DEFAULT_GROUP_SETTINGS, groups, memberships } from '$lib/server/db/schema';
import { addMember, createGroup } from '$lib/server/groups';
import { drawForNight, scheduleNight } from '$lib/server/nights';
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

const { load } = await import('./+page.server');

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
