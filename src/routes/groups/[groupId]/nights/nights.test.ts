import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { applyMigrations, createDb, type DB } from '$lib/server/db/client';
import { addMember, createGroup } from '$lib/server/groups';
import { DEFAULT_GROUP_SETTINGS, groups, memberships, movieNights } from '$lib/server/db/schema';
import { drawForNight, listNights, scheduleNight } from '$lib/server/nights';
import { addSuggestion } from '$lib/server/suggestions';
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

const { load } = await import('./+page.server');
// Scheduling has its own page, like adding a film.
const { load: planLoad, actions } = await import('./new/+page.server');

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

	it('takes a time typed with a dot or without one, and refuses one that is not', async () => {
		expect(await schedule(ada, { day: '2030-07-01', time: '19.45' })).toMatchObject({
			status: 303
		});
		expect(await schedule(ada, { day: '2030-07-02', time: '1945' })).toMatchObject({ status: 303 });
		expect(listNights(db, groupId).map((n) => n.scheduledAt.toISOString())).toEqual([
			'2030-07-02T17:45:00.000Z',
			'2030-07-01T17:45:00.000Z'
		]);
		expect(await schedule(ada, { day: '2030-07-03', time: '25:00' })).toMatchObject({
			status: 400,
			data: { error: 'nights.error.time', time: '25:00' }
		});
	});

	it('asks for a day when none was picked', async () => {
		expect(await schedule(ada, { time: '20:00' })).toMatchObject({
			status: 400,
			data: { error: 'nights.error.day' }
		});
	});

	it('lets a member who does not own the group schedule too', async () => {
		expect(await schedule(grace, { day: '2030-07-01', time: '20:00' })).toMatchObject({
			status: 303
		});
		expect(listNights(db, groupId)).toHaveLength(1);
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
	});

	it('suggests the last night’s time on the schedule page, never a day before today', async () => {
		await schedule(ada, { day: '2030-07-01', time: '20:00' });
		const data = (await planLoad({
			params: { groupId },
			locals: locals(grace),
			url: new URL('http://x/')
		} as never)) as Exclude<Awaited<ReturnType<typeof planLoad>>, void>;
		// The last night was 1 July 2030, a Monday at 20:00: the form suggests
		// the same time next time.
		expect(data.defaults).toMatchObject({ time: '20:00' });
		// The date field's lower bound is the instance's today.
		expect(data.today).toMatch(/^\d{4}-\d{2}-\d{2}$/);
		expect(data.defaults.day! >= data.today).toBe(true);
	});

	it('suggests the group’s usual time, but only the viewer’s own place', async () => {
		const defaults = async (userId: string) =>
			(
				(await planLoad({
					params: { groupId },
					locals: locals(userId),
					url: new URL('http://x/')
				} as never)) as Exclude<Awaited<ReturnType<typeof planLoad>>, void>
			).defaults;
		await schedule(ada, { day: '2030-07-01', time: '20:00', location: "Ada's sofa" });
		expect(await defaults(ada)).toMatchObject({ time: '20:00', location: "Ada's sofa" });
		expect(await defaults(grace)).toMatchObject({ time: '20:00', location: '' });
		await schedule(grace, { day: '2030-07-08', time: '21:00', location: "Grace's garden" });
		expect(await defaults(ada)).toMatchObject({ time: '21:00', location: "Ada's sofa" });
		// A later night of Ada's without a place keeps her sofa as the suggestion.
		await schedule(ada, { day: '2030-07-15', time: '21:00' });
		expect(await defaults(ada)).toMatchObject({ location: "Ada's sofa" });
	});

	it('lists a night watched early under past, and a cancelled one nowhere', async () => {
		await schedule(ada, { day: '2030-07-01', time: '20:00' });
		await schedule(ada, { day: '2030-07-08', time: '20:00' });
		await schedule(ada, { day: '2030-07-15', time: '20:00' });
		const [off, later, early] = listNights(db, groupId);
		db.update(movieNights).set({ status: 'watched' }).where(eq(movieNights.id, early.id)).run();
		db.update(movieNights).set({ status: 'cancelled' }).where(eq(movieNights.id, off.id)).run();
		const data = (await load({
			params: { groupId },
			locals: locals(grace),
			url: new URL('http://x/')
		} as never)) as Exclude<Awaited<ReturnType<typeof load>>, void>;
		expect(data.upcoming.map((n: { id: string }) => n.id)).toEqual([later.id]);
		expect(data.past.map((n: { id: string }) => n.id)).toEqual([early.id]);
		expect(JSON.stringify(data)).not.toContain(off.id);
	});

	it('names the drawn film, unless the group keeps it a surprise', async () => {
		addSuggestion(db, {
			groupId,
			userId: ada,
			movie: { title: 'Dune' },
			settings: DEFAULT_GROUP_SETTINGS
		});
		const id = scheduleNight(db, {
			groupId,
			userId: ada,
			scheduledAt: new Date(Date.now() + 86_400_000),
			location: null
		});
		drawForNight(db, id, ada);
		const list = async () =>
			(await load({
				params: { groupId },
				locals: locals(grace),
				url: new URL('http://x/')
			} as never)) as Exclude<Awaited<ReturnType<typeof load>>, void>;
		expect((await list()).upcoming[0]).toMatchObject({
			film: { title: 'Dune' },
			filmHidden: false
		});
		db.update(groups)
			.set({ settings: { ...DEFAULT_GROUP_SETTINGS, resultVisible: 'on_night' } })
			.where(eq(groups.id, groupId))
			.run();
		const data = await list();
		expect(data.upcoming[0]).toMatchObject({ film: null, filmHidden: true });
		// Withheld from the payload, not just from the markup.
		expect(JSON.stringify(data)).not.toContain('Dune');
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
		expect((await nightsFor(grace)).upcoming.map((n: { isNew: boolean }) => n.isNew)).toEqual([
			true
		]);
		expect((await nightsFor(grace)).upcoming.map((n: { isNew: boolean }) => n.isNew)).toEqual([
			false
		]);
	});

	it('never badges a night for the owner', async () => {
		expect((await nightsFor(ada)).upcoming.map((n: { isNew: boolean }) => n.isNew)).toEqual([
			false
		]);
	});
});
