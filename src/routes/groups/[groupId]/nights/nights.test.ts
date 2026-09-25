import { beforeEach, describe, expect, it, vi } from 'vitest';
import { applyMigrations, createDb, type DB } from '$lib/server/db/client';
import { addMember, createGroup } from '$lib/server/groups';
import { listNights } from '$lib/server/nights';
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
		const result = await schedule(ada, { when: '2030-07-01T20:00', location: 'Sofa' });
		expect(result).toMatchObject({ status: 303 });
		const [night] = listNights(db, groupId);
		// 20:00 in Berlin in July is 18:00 UTC.
		expect(night.scheduledAt.toISOString()).toBe('2030-07-01T18:00:00.000Z');
		expect(night.location).toBe('Sofa');
	});

	it('refuses a moment that has passed, and one that is not a time', async () => {
		expect(await schedule(ada, { when: '2001-01-01T20:00' })).toMatchObject({
			status: 400,
			data: { error: 'nights.error.past' }
		});
		expect(await schedule(ada, { when: 'tomorrow' })).toMatchObject({
			status: 400,
			data: { error: 'nights.error.when' }
		});
		expect(listNights(db, groupId)).toHaveLength(0);
	});

	it('refuses a member who does not own the group', async () => {
		expect(await schedule(grace, { when: '2030-07-01T20:00' })).toMatchObject({ status: 403 });
		expect(listNights(db, groupId)).toHaveLength(0);
	});
});

describe('the list', () => {
	it('shows members the group’s nights, formatted in the instance timezone', async () => {
		await schedule(ada, { when: '2030-07-01T20:00' });
		const data = (await load({ params: { groupId }, locals: locals(grace) } as never)) as Exclude<
			Awaited<ReturnType<typeof load>>,
			void
		>;
		expect(data.upcoming).toHaveLength(1);
		expect(data.upcoming[0].when).toContain('20:00');
		expect(data.isOwner).toBe(false);
	});
});
