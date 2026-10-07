import { beforeEach, describe, expect, it, vi } from 'vitest';
let mailConfigured = true;
vi.mock('./mail', () => ({
	isMailConfigured: () => mailConfigured,
	sendMail: () => Promise.resolve(true)
}));
import { eq } from 'drizzle-orm';
import { applyMigrations, createDb, type DB } from './db/client';
import { users } from './db/schema';
import { addMember, createGroup, leaveGroup } from './groups';
import { scheduleNight } from './nights';
import { createUser, setEmail } from './users';
import { nightMailInfo, nightMailRecipients, sendNightMail } from './night-mail';

let db: DB;
let ada: string; // owner
let grace: string;
let alan: string;
let lin: string;
let groupId: string;
let nightId: string;

function person(username: string, email: string | null) {
	const id = createUser(db, { username, displayName: username, passwordHash: 'x' }).id;
	if (email) setEmail(db, id, email);
	return id;
}

type Sent = {
	to: string;
	subject: string;
	body: string;
	calendar?: { method: string; content: string };
};
let sent: Sent[];
const send = (to: string, subject: string, body: string, calendar?: Sent['calendar']) => {
	sent.push({ to, subject, body, calendar });
	return Promise.resolve(true);
};

beforeEach(() => {
	db = createDb(':memory:').db;
	applyMigrations(db);
	sent = [];
	mailConfigured = true;
	ada = person('ada', 'ada@example.org');
	grace = person('grace', 'grace@example.org');
	alan = person('alan', null);
	lin = person('lin', 'lin@example.org');
	groupId = createGroup(db, { name: 'Filmnacht', ownerId: ada });
	for (const id of [grace, alan, lin]) addMember(db, id, groupId);
	nightId = scheduleNight(db, {
		groupId,
		userId: ada,
		scheduledAt: new Date('2030-07-01T18:00:00Z'),
		location: 'Sofa'
	});
});

describe('nightMailInfo', () => {
	it('gives the group, time, end and place', () => {
		expect(nightMailInfo(db, nightId)).toMatchObject({
			groupId,
			groupName: 'Filmnacht',
			status: 'scheduled',
			scheduledAt: new Date('2030-07-01T18:00:00Z'),
			endsAt: new Date('2030-07-01T21:00:00Z'),
			location: 'Sofa'
		});
	});
});

describe('nightMailRecipients', () => {
	it('lists members with an address, minus the acting owner', () => {
		expect(nightMailRecipients(db, nightId, ada).sort()).toEqual([
			'grace@example.org',
			'lin@example.org'
		]);
	});

	it('leaves out whoever opted out or left', () => {
		db.update(users).set({ nightMails: false }).where(eq(users.id, grace)).run();
		leaveGroup(db, lin, groupId);
		expect(nightMailRecipients(db, nightId, ada)).toEqual([]);
	});
});

describe('sendNightMail', () => {
	it('sends the invite with a REQUEST calendar and no film', async () => {
		expect(await sendNightMail(db, nightId, 'scheduled', ada, 'https://f.example', send)).toBe(2);
		expect(sent[0].subject).toContain('Filmnacht: movie night on');
		expect(sent[0].body).toContain('https://f.example/groups/');
		expect(sent[0].calendar?.method).toBe('REQUEST');
		expect(sent[0].calendar?.content).toContain('UID:night-' + nightId + '@filmnacht');
	});

	it('sends the cancellation with a CANCEL calendar for the same event', async () => {
		await sendNightMail(db, nightId, 'cancelled', ada, null, send);
		expect(sent[0].subject).toContain('cancelled');
		expect(sent[0].calendar?.method).toBe('CANCEL');
		expect(sent[0].calendar?.content).toContain('UID:night-' + nightId + '@filmnacht');
	});

	it('sends nothing without SMTP', async () => {
		mailConfigured = false;
		expect(await sendNightMail(db, nightId, 'scheduled', ada, null, send)).toBe(0);
		expect(sent).toEqual([]);
	});

	it('keeps sending when one recipient throws', async () => {
		const flaky: typeof send = (to, subject, body, calendar) => {
			if (to === 'grace@example.org') throw new Error('smtp exploded');
			return send(to, subject, body, calendar);
		};
		await sendNightMail(db, nightId, 'scheduled', ada, null, flaky);
		expect(sent.map((s) => s.to)).toEqual(['lin@example.org']);
	});
});
