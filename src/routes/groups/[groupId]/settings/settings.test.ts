import { DEFAULT_GROUP_SETTINGS } from '$lib/server/db/schema';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { applyMigrations, createDb, type DB } from '$lib/server/db/client';
import { addMember, createGroup, listGroupsFor, requireMember } from '$lib/server/groups';
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

// No real SMTP in tests: a fake whose status this suite flips per test.
let mailConfigured = true;
vi.mock('$lib/server/mail', () => ({
	isMailConfigured: () => mailConfigured
}));

const { load, actions } = await import('./+page.server');

function locals(userId: string) {
	return { user: { id: userId, displayName: 'x', isAdmin: false }, locale: 'en' as const };
}

async function run<T>(fn: () => T | Promise<T>): Promise<T | { status: number }> {
	try {
		return await fn();
	} catch (e) {
		// error() and redirect() both throw; hand back what they carried.
		return e as { status: number };
	}
}

async function get(userId: string) {
	return run(() => load({ params: { groupId }, locals: locals(userId) } as never));
}

async function post(userId: string, fields: Record<string, string>) {
	return run(() =>
		actions.save({
			params: { groupId },
			locals: locals(userId),
			request: new Request('http://localhost/x', {
				method: 'POST',
				body: new URLSearchParams(fields)
			})
		} as never)
	);
}

beforeEach(() => {
	db = createDb(':memory:').db;
	applyMigrations(db);
	mailConfigured = true;
	ada = createUser(db, { username: 'ada', displayName: 'Ada', passwordHash: 'x' }).id;
	grace = createUser(db, { username: 'grace', displayName: 'Grace', passwordHash: 'x' }).id;
	groupId = createGroup(db, { name: 'Filmnacht', ownerId: ada });
	addMember(db, grace, groupId);
});

describe('POST /groups/:id/settings ?/save', () => {
	it('lets the owner save every field', async () => {
		const result = await post(ada, {
			autoDraw: 'on',
			autoDrawHoursBefore: '6',
			surprise: 'on',
			maxOpenSuggestions: '5',
			nightEndsAfterHours: '4',
			ratingWindowDays: '14'
			// fairDraw left unchecked
		});
		expect(result).toEqual({ saved: true });
		expect(requireMember(db, ada, groupId).settings).toEqual({
			autoDraw: true,
			autoDrawHoursBefore: 6,
			resultVisible: 'on_night',
			drawMode: 'uniform',
			maxOpenSuggestions: 5,
			nightEndsAfterMinutes: 240,
			ratingWindowDays: 14
		});
	});

	it('treats an absent checkbox as off', async () => {
		await post(ada, {
			autoDrawHoursBefore: '2',
			maxOpenSuggestions: '1',
			nightEndsAfterHours: '2',
			ratingWindowDays: '3'
			// autoDraw, surprise, fairDraw all absent
		});
		expect(requireMember(db, ada, groupId).settings).toMatchObject({
			autoDraw: false,
			resultVisible: 'immediately',
			drawMode: 'uniform'
		});
	});

	it('takes any whole number inside a range, the night’s length kept in minutes', async () => {
		expect(
			await post(ada, {
				autoDrawHoursBefore: '36',
				maxOpenSuggestions: '3',
				nightEndsAfterHours: '5',
				ratingWindowDays: '30'
			})
		).toEqual({ saved: true });
		expect(requireMember(db, ada, groupId).settings).toMatchObject({
			autoDrawHoursBefore: 36,
			nightEndsAfterMinutes: 300,
			ratingWindowDays: 30
		});
	});

	it('refuses a number outside its range, a fraction or an empty field, and saves nothing', async () => {
		const fields = {
			autoDrawHoursBefore: '24',
			maxOpenSuggestions: '3',
			nightEndsAfterHours: '3',
			ratingWindowDays: '7'
		};
		for (const bad of [
			{ maxOpenSuggestions: '99' },
			{ autoDrawHoursBefore: '0' },
			{ nightEndsAfterHours: '2.5' },
			{ ratingWindowDays: '' }
		]) {
			expect(await post(ada, { ...fields, ...bad })).toMatchObject({
				status: 400,
				data: { error: 'settings.error.invalid' }
			});
		}
		expect(requireMember(db, ada, groupId).settings).toEqual(DEFAULT_GROUP_SETTINGS);
	});

	it('refuses automatic draw when mail is not configured, and saves nothing', async () => {
		mailConfigured = false;
		expect(
			await post(ada, {
				autoDraw: 'on',
				autoDrawHoursBefore: '24',
				maxOpenSuggestions: '3',
				nightEndsAfterHours: '3',
				ratingWindowDays: '7'
			})
		).toMatchObject({ status: 400, data: { error: 'settings.error.no_mail' } });
		expect(requireMember(db, ada, groupId).settings).toMatchObject({ autoDraw: false });
	});

	it('lets a save through when automatic draw is already on and mail has since broken', async () => {
		// Turn autoDraw on while mail still works.
		await post(ada, {
			autoDraw: 'on',
			autoDrawHoursBefore: '24',
			maxOpenSuggestions: '3',
			nightEndsAfterHours: '3',
			ratingWindowDays: '7'
		});
		mailConfigured = false;

		// Saving an unrelated field must still succeed, and must not silently
		// turn autoDraw off: the mail check only refuses TURNING IT ON.
		const result = await post(ada, {
			autoDraw: 'on',
			autoDrawHoursBefore: '24',
			maxOpenSuggestions: '5',
			nightEndsAfterHours: '3',
			ratingWindowDays: '7'
		});
		expect(result).toEqual({ saved: true });
		expect(requireMember(db, ada, groupId).settings).toMatchObject({
			autoDraw: true,
			maxOpenSuggestions: 5
		});
	});

	it('gives a member who is not the owner a 403, and saves nothing', async () => {
		expect(
			await post(grace, {
				autoDrawHoursBefore: '24',
				maxOpenSuggestions: '5',
				nightEndsAfterHours: '3',
				ratingWindowDays: '7'
			})
		).toMatchObject({ status: 403 });
		expect(requireMember(db, ada, groupId).settings).toMatchObject({ maxOpenSuggestions: 3 });
	});

	it('gives a non-member a 404', async () => {
		const mallory = createUser(db, {
			username: 'mallory',
			displayName: 'Mallory',
			passwordHash: 'x'
		}).id;
		expect(
			await post(mallory, {
				autoDrawHoursBefore: '24',
				maxOpenSuggestions: '5',
				nightEndsAfterHours: '3',
				ratingWindowDays: '7'
			})
		).toMatchObject({ status: 404 });
	});
});

describe('GET /groups/:id/settings', () => {
	it('returns the settings, the allowed ranges and whether mail works', async () => {
		const data = (await get(ada)) as {
			settings: unknown;
			ranges: unknown;
			mailConfigured: boolean;
		};
		expect(data.settings).toMatchObject({ autoDraw: false, autoDrawHoursBefore: 24 });
		expect(data.ranges).toEqual({
			autoDrawHoursBefore: { min: 1, max: 72 },
			maxOpenSuggestions: { min: 1, max: 10 },
			nightEndsAfterHours: { min: 1, max: 8 },
			ratingWindowDays: { min: 1, max: 30 }
		});
		expect(data.mailConfigured).toBe(true);
	});

	it('gives a member who is not the owner a 403', async () => {
		expect(await get(grace)).toMatchObject({ status: 403 });
	});

	it('gives a non-member a 404', async () => {
		const mallory = createUser(db, {
			username: 'mallory',
			displayName: 'Mallory',
			passwordHash: 'x'
		}).id;
		expect(await get(mallory)).toMatchObject({ status: 404 });
	});
});

describe('POST /groups/:id/settings ?/deleteGroup', () => {
	const remove = (userId: string, fields: Record<string, string>) =>
		run(() =>
			actions.deleteGroup({
				params: { groupId },
				locals: locals(userId),
				request: new Request('http://localhost/x', {
					method: 'POST',
					body: new URLSearchParams(fields)
				})
			} as never)
		);

	it('deletes the group when the owner types its name', async () => {
		expect(await remove(ada, { name: '  Filmnacht ' })).toMatchObject({
			status: 303,
			location: '/groups'
		});
		expect(listGroupsFor(db, ada)).toEqual([]);
		expect(listGroupsFor(db, grace)).toEqual([]);
	});

	it('refuses a name that does not match, and deletes nothing', async () => {
		expect(await remove(ada, { name: 'filmnacht' })).toMatchObject({
			status: 400,
			data: { error: 'settings.error.delete_name' }
		});
		expect(listGroupsFor(db, ada)).toHaveLength(1);
	});

	it('refuses a member who is not the owner, and a stranger', async () => {
		expect(await remove(grace, { name: 'Filmnacht' })).toMatchObject({ status: 403 });
		const lin = createUser(db, { username: 'lin', displayName: 'Lin', passwordHash: 'x' }).id;
		expect(await remove(lin, { name: 'Filmnacht' })).toMatchObject({ status: 404 });
		expect(listGroupsFor(db, ada)).toHaveLength(1);
	});
});
