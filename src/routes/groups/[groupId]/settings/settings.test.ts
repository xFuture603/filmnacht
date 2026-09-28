import { beforeEach, describe, expect, it, vi } from 'vitest';
import { applyMigrations, createDb, type DB } from '$lib/server/db/client';
import { addMember, createGroup, requireMember } from '$lib/server/groups';
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
			nightEndsAfterMinutes: '240',
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
			nightEndsAfterMinutes: '120',
			ratingWindowDays: '3'
			// autoDraw, surprise, fairDraw all absent
		});
		expect(requireMember(db, ada, groupId).settings).toMatchObject({
			autoDraw: false,
			resultVisible: 'immediately',
			drawMode: 'uniform'
		});
	});

	it('refuses a value outside the offered choices, and saves nothing', async () => {
		expect(
			await post(ada, {
				autoDrawHoursBefore: '24',
				maxOpenSuggestions: '99',
				nightEndsAfterMinutes: '180',
				ratingWindowDays: '7'
			})
		).toMatchObject({ status: 400, data: { error: 'settings.error.invalid' } });
		expect(requireMember(db, ada, groupId).settings).toMatchObject({ maxOpenSuggestions: 3 });
	});

	it('refuses automatic draw when mail is not configured, and saves nothing', async () => {
		mailConfigured = false;
		expect(
			await post(ada, {
				autoDraw: 'on',
				autoDrawHoursBefore: '24',
				maxOpenSuggestions: '3',
				nightEndsAfterMinutes: '180',
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
			nightEndsAfterMinutes: '180',
			ratingWindowDays: '7'
		});
		mailConfigured = false;

		// Saving an unrelated field must still succeed, and must not silently
		// turn autoDraw off: the mail check only refuses TURNING IT ON.
		const result = await post(ada, {
			autoDraw: 'on',
			autoDrawHoursBefore: '24',
			maxOpenSuggestions: '5',
			nightEndsAfterMinutes: '180',
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
				nightEndsAfterMinutes: '180',
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
				nightEndsAfterMinutes: '180',
				ratingWindowDays: '7'
			})
		).toMatchObject({ status: 404 });
	});
});

describe('GET /groups/:id/settings', () => {
	it('returns the settings, the offered choices and whether mail works', async () => {
		const data = (await get(ada)) as {
			settings: unknown;
			choices: unknown;
			mailConfigured: boolean;
		};
		expect(data.settings).toMatchObject({ autoDraw: false, autoDrawHoursBefore: 24 });
		expect(data.choices).toEqual({
			autoDrawHoursBefore: [2, 6, 12, 24, 48],
			maxOpenSuggestions: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
			nightEndsAfterMinutes: [120, 180, 240],
			ratingWindowDays: [3, 7, 14]
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
