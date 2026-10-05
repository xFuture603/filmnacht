import { beforeEach, describe, expect, it, vi } from 'vitest';
import { applyMigrations, createDb, type DB } from '$lib/server/db/client';
import { addMember, createGroup } from '$lib/server/groups';
import { memberships } from '$lib/server/db/schema';
import { listNights, scheduleNight } from '$lib/server/nights';
import { setSetting } from '$lib/server/settings';
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

function locals(userId: string) {
	return { user: { id: userId, displayName: 'x', isAdmin: false }, locale: 'en' as const };
}

async function schedule(userId: string, fields: Record<string, string>) {
	try {
		return await actions.schedule({
			params: { groupId },
			locals: locals(userId),
			request: new Request('http://localhost/x', {
				method: 'POST',
				body: new URLSearchParams(fields)
			})
		} as never);
	} catch (e) {
		// redirect() and error() both throw; hand back what they carried.
		return e as { status: number; location?: string };
	}
}

beforeEach(() => {
	db = createDb(':memory:').db;
	applyMigrations(db);
	setSetting(db, 'timezone', 'Europe/Berlin');
	ada = createUser(db, { username: 'ada', displayName: 'Ada', passwordHash: 'x' }).id;
	grace = createUser(db, { username: 'grace', displayName: 'Grace', passwordHash: 'x' }).id;
	groupId = createGroup(db, { name: 'Filmnacht', ownerId: ada });
	addMember(db, grace, groupId);
});

describe('scheduling from the form', () => {
	it('reads the wall-clock time in the instance timezone, not the server’s', async () => {
		const result = await schedule(ada, { day: '2030-07-01', time: '20:00', location: 'Sofa' });
		expect(result).toMatchObject({ status: 303 });
		const [night] = listNights(db, groupId);
		// 20:00 in Berlin in July is 18:00 UTC.
		expect(night.scheduledAt.toISOString()).toBe('2030-07-01T18:00:00.000Z');
		expect(night.location).toBe('Sofa');
	});

	it('refuses a moment that has passed, and one that is not a time', async () => {
		expect(await schedule(ada, { day: '2001-01-01', time: '20:00' })).toMatchObject({
			status: 400,
			data: { error: 'nights.error.past' }
		});
		expect(await schedule(ada, { day: 'tomorrow', time: '20:00' })).toMatchObject({
			status: 400,
			data: { error: 'nights.error.when' }
		});
		expect(listNights(db, groupId)).toHaveLength(0);
	});

	it('asks for a day when none was picked', async () => {
		expect(await schedule(ada, { time: '20:00' })).toMatchObject({
			status: 400,
			data: { error: 'nights.error.day' }
		});
	});

	it('refuses a member who does not own the group', async () => {
		expect(await schedule(grace, { day: '2030-07-01', time: '20:00' })).toMatchObject({
			status: 403
		});
		expect(listNights(db, groupId)).toHaveLength(0);
	});
});

describe('the calendar month', () => {
	function month(value: string) {
		return load({
			params: { groupId },
			locals: locals(ada),
			url: new URL(`http://x/?month=${value}`)
		} as never) as Promise<{ month: string; today: string }>;
	}

	it('opens the month asked for', async () => {
		expect((await month('2031-03')).month).toBe('2031-03');
	});

	it('never opens a month before this one, nor a malformed one', async () => {
		const { today } = await month('2001-01');
		expect((await month('2001-01')).month).toBe(today.slice(0, 7));
		expect((await month('garbage')).month).toBe(today.slice(0, 7));
	});
});

describe('the list', () => {
	it('shows members the group’s nights, formatted in the instance timezone', async () => {
		await schedule(ada, { day: '2030-07-01', time: '20:00' });
		const data = (await load({
			params: { groupId },
			locals: locals(grace),
			url: new URL('http://x/')
		} as never)) as Exclude<Awaited<ReturnType<typeof load>>, void>;
		expect(data.upcoming).toHaveLength(1);
		expect(data.upcoming[0].when).toContain('20:00');
		expect(data.isOwner).toBe(false);
		// The last night was 1 July 2030, a Monday at 20:00: the form suggests
		// the same time and place next time.
		expect(data.defaults).toMatchObject({ time: '20:00' });
		// The calendar opens on the suggested day's month.
		expect(data.month).toBe(data.defaults.day?.slice(0, 7));
		expect(data.timezone).toBe('Europe/Berlin');
	});

	it('gives somebody outside the group a 404', async () => {
		const mallory = createUser(db, {
			username: 'mallory',
			displayName: 'Mallory',
			passwordHash: 'x'
		}).id;
		let status: number | undefined;
		try {
			await load({
				params: { groupId },
				locals: locals(mallory),
				url: new URL('http://x/')
			} as never);
		} catch (e) {
			status = (e as { status: number }).status;
		}
		expect(status).toBe(404);
	});
});

describe('new nights', () => {
	type Data = Exclude<Awaited<ReturnType<typeof load>>, void>;
	const nightsFor = async (userId: string) =>
		(await load({
			params: { groupId },
			locals: locals(userId),
			url: new URL('http://localhost/x')
		} as never)) as Data;

	beforeEach(() => {
		db.update(memberships)
			.set({ joinedAt: new Date(Date.now() - 3_600_000) })
			.run();
		scheduleNight(db, {
			groupId,
			userId: ada,
			scheduledAt: new Date(Date.now() + 86_400_000),
			location: null
		});
	});

	it('badges a new night for a member once', async () => {
		expect((await nightsFor(grace)).upcoming.map((n) => n.isNew)).toEqual([true]);
		expect((await nightsFor(grace)).upcoming.map((n) => n.isNew)).toEqual([false]);
	});

	it('never badges a night for the owner', async () => {
		expect((await nightsFor(ada)).upcoming.map((n) => n.isNew)).toEqual([false]);
	});
});
