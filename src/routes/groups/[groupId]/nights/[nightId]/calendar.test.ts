import { beforeEach, describe, expect, it, vi } from 'vitest';
import { applyMigrations, createDb, type DB } from '$lib/server/db/client';
import { addMember, createGroup } from '$lib/server/groups';
import { cancelNight, scheduleNight } from '$lib/server/nights';
import { setSetting } from '$lib/server/settings';
import { createUser } from '$lib/server/users';

let db: DB;
vi.mock('$lib/server/db', () => ({
	get db() {
		return db;
	}
}));
const { GET } = await import('./calendar.ics/+server');

let ada: string;
let mallory: string;
let groupId: string;
let otherGroup: string;
let nightId: string;

const get = (userId: string, params = { groupId, nightId }) =>
	Promise.resolve()
		.then(() =>
			GET({
				params,
				locals: { user: { id: userId, displayName: 'x', isAdmin: false }, locale: 'en' },
				url: new URL('https://f.example/x')
			} as never)
		)
		.catch((e) => e as { status: number });

beforeEach(() => {
	db = createDb(':memory:').db;
	applyMigrations(db);
	setSetting(db, 'timezone', 'Europe/Berlin');
	ada = createUser(db, { username: 'ada', displayName: 'Ada', passwordHash: 'x' }).id;
	mallory = createUser(db, { username: 'mallory', displayName: 'M', passwordHash: 'x' }).id;
	groupId = createGroup(db, { name: 'Filmnacht', ownerId: ada });
	otherGroup = createGroup(db, { name: 'Elsewhere', ownerId: mallory });
	addMember(db, ada, otherGroup);
	nightId = scheduleNight(db, {
		groupId,
		userId: ada,
		scheduledAt: new Date('2030-07-01T18:00:00Z'),
		location: 'Sofa'
	});
});

describe('GET calendar.ics', () => {
	it('gives a member the night as a downloadable calendar file', async () => {
		const res = (await get(ada)) as Response;
		expect(res.headers.get('content-type')).toBe('text/calendar; charset=utf-8');
		expect(res.headers.get('content-disposition')).toBe(
			'attachment; filename="filmnacht-2030-07-01.ics"'
		);
		const body = await res.text();
		expect(body).toContain('METHOD:PUBLISH');
		expect(body).toContain(`UID:night-${nightId}@filmnacht`);
	});

	it('is not found for a non-member', async () => {
		expect(await get(mallory)).toMatchObject({ status: 404 });
	});

	it('is not found once the night is cancelled', async () => {
		cancelNight(db, nightId, ada);
		expect(await get(ada)).toMatchObject({ status: 404 });
	});

	it("is not found through another group's URL", async () => {
		expect(await get(ada, { groupId: otherGroup, nightId })).toMatchObject({ status: 404 });
	});
});
