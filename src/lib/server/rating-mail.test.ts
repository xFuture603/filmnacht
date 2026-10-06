import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it, vi } from 'vitest';
let mailConfigured = true;
vi.mock('./mail', () => ({
	isMailConfigured: () => mailConfigured,
	sendMail: () => Promise.resolve(true)
}));

import { applyMigrations, createDb, type DB } from './db/client';
import { DEFAULT_GROUP_SETTINGS, movieNights, suggestions, users } from './db/schema';
import { addMember, createGroup, leaveGroup } from './groups';
import { cancelNight, drawForNight, markWatched, scheduleNight } from './nights';
import { saveRating } from './ratings';
import { addSuggestion } from './suggestions';
import { createUser, setEmail } from './users';
import {
	claimRatingMail,
	composeRatingMail,
	dueRatingMails,
	ratingMailInfo,
	ratingRecipients,
	runRatingMails
} from './rating-mail';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const START = new Date('2030-03-01T19:00:00Z');
const OPENS = new Date(START.getTime() + 3 * HOUR); // default night: 180 minutes
const CLOSES = new Date(OPENS.getTime() + 7 * DAY); // default window: 7 days

let db: DB;
let ada: string; // owner
let grace: string;
let alan: string;
let groupId: string;
let nightId: string;

function person(username: string, email: string | null) {
	const id = createUser(db, { username, displayName: username, passwordHash: 'x' }).id;
	if (email) setEmail(db, id, email);
	return id;
}

beforeEach(() => {
	db = createDb(':memory:').db;
	applyMigrations(db);
	ada = person('ada', 'ada@example.org');
	grace = person('grace', 'grace@example.org');
	alan = person('alan', null);
	groupId = createGroup(db, { name: 'Filmnacht', ownerId: ada });
	addMember(db, grace, groupId);
	addMember(db, alan, groupId);
	addSuggestion(db, {
		groupId,
		userId: grace,
		movie: { title: 'Dune' },
		settings: DEFAULT_GROUP_SETTINGS
	});
	nightId = scheduleNight(db, { groupId, userId: ada, scheduledAt: START, location: null });
	drawForNight(db, nightId, ada);
});

describe('dueRatingMails', () => {
	it('is empty before the window opens', () => {
		expect(dueRatingMails(db, new Date(OPENS.getTime() - 1000))).toEqual([]);
	});

	it('makes the open email due once the night ends', () => {
		expect(dueRatingMails(db, OPENS)).toEqual([{ nightId, kind: 'open', lastDay: false }]);
	});

	it('makes the open email due as soon as the night is marked watched early', () => {
		markWatched(db, nightId, ada);
		expect(dueRatingMails(db, new Date())).toEqual([{ nightId, kind: 'open', lastDay: false }]);
	});

	it('flags an open email that comes with less than a day left', () => {
		const late = new Date(CLOSES.getTime() - 2 * HOUR);
		expect(dueRatingMails(db, late)).toEqual([{ nightId, kind: 'open', lastDay: true }]);
	});

	it('makes the reminder due only in the last day, after an open email a day old', () => {
		expect(claimRatingMail(db, { nightId, kind: 'open', lastDay: false }, OPENS)).toBe(true);
		expect(dueRatingMails(db, new Date(CLOSES.getTime() - DAY - 1000))).toEqual([]);
		expect(dueRatingMails(db, new Date(CLOSES.getTime() - DAY))).toEqual([
			{ nightId, kind: 'reminder', lastDay: true }
		]);
	});

	it('waits a full day after a late open email before reminding', () => {
		// The open email went out with a day and a half left, e.g. mail set up late.
		claimRatingMail(
			db,
			{ nightId, kind: 'open', lastDay: false },
			new Date(CLOSES.getTime() - 1.5 * DAY)
		);
		expect(dueRatingMails(db, new Date(CLOSES.getTime() - DAY))).toEqual([]);
		expect(dueRatingMails(db, new Date(CLOSES.getTime() - 0.5 * DAY))).toEqual([
			{ nightId, kind: 'reminder', lastDay: true }
		]);
	});

	it('has nothing due for a closed window or a cancelled night', () => {
		expect(dueRatingMails(db, CLOSES)).toEqual([]);
		cancelNight(db, nightId, ada);
		expect(dueRatingMails(db, OPENS)).toEqual([]);
	});
});

describe('claimRatingMail', () => {
	it('claims each email once', () => {
		const due = { nightId, kind: 'open' as const, lastDay: false };
		expect(claimRatingMail(db, due, OPENS)).toBe(true);
		expect(claimRatingMail(db, due, OPENS)).toBe(false);
	});

	it('skips the reminder when the open email comes on the last day', () => {
		claimRatingMail(db, { nightId, kind: 'open', lastDay: true }, OPENS);
		const row = db
			.select({ reminder: movieNights.ratingReminderMailedAt })
			.from(movieNights)
			.where(eq(movieNights.id, nightId))
			.get()!;
		expect(row.reminder).not.toBeNull();
	});
});

describe('ratingRecipients', () => {
	it('lists members with an address who have not rated and did not opt out', () => {
		expect(ratingRecipients(db, nightId).sort()).toEqual(['ada@example.org', 'grace@example.org']);
	});

	it('leaves out whoever has rated, opted out, or left', () => {
		saveRating(db, { nightId, userId: grace, scoreX2: 14, comment: null, now: OPENS });
		expect(ratingRecipients(db, nightId)).toEqual(['ada@example.org']);
		db.update(users).set({ ratingMails: false }).where(eq(users.id, ada)).run();
		expect(ratingRecipients(db, nightId)).toEqual([]);
		db.update(users).set({ ratingMails: true }).where(eq(users.id, ada)).run();
		leaveGroup(db, ada, groupId);
		expect(ratingRecipients(db, nightId)).toEqual([]);
	});
});

describe('ratingMailInfo', () => {
	it('names the group, the film and when rating closes', () => {
		expect(ratingMailInfo(db, nightId, OPENS)).toEqual({
			groupId,
			groupName: 'Filmnacht',
			title: 'Dune',
			closesAt: CLOSES
		});
	});

	it('still has the title for a wildcard film', () => {
		db.update(suggestions).set({ suggestedBy: null }).run();
		expect(ratingMailInfo(db, nightId, OPENS)?.title).toBe('Dune');
	});
});

describe('composeRatingMail', () => {
	const base = {
		locale: 'en' as const,
		groupName: 'Filmnacht',
		title: 'Dune',
		closes: 'Saturday 8 March 2030 at 22:00',
		link: 'https://f.example/groups/g/nights/n',
		profileLink: 'https://f.example/profile'
	};

	it('asks how it was, by when, with the link and the way out', () => {
		const { subject, body } = composeRatingMail({ ...base, kind: 'open' });
		expect(subject).toBe('How was Dune?');
		expect(body).toContain('Filmnacht watched Dune');
		expect(body).toContain(base.closes);
		expect(body).toContain(base.link);
		expect(body).toContain('Switch them off on your profile: https://f.example/profile');
	});

	it('says it closes tomorrow in the reminder', () => {
		expect(composeRatingMail({ ...base, kind: 'reminder' }).subject).toBe(
			'Rating for Dune closes tomorrow'
		);
	});

	it('leaves the links out without an origin', () => {
		const { body } = composeRatingMail({ ...base, kind: 'open', link: null, profileLink: null });
		expect(body).not.toContain('https://');
		expect(body).toContain('Switch them off on your profile.');
	});
});

describe('runRatingMails', () => {
	let sent: Array<{ to: string; subject: string }>;
	const send = (to: string, subject: string) => {
		sent.push({ to, subject });
		return Promise.resolve(true);
	};

	beforeEach(() => {
		sent = [];
		mailConfigured = true;
	});

	it('sends the open email once, across two ticks', async () => {
		await runRatingMails(db, OPENS, 'https://f.example', send);
		await runRatingMails(db, OPENS, 'https://f.example', send);
		expect(sent.map((s) => s.to).sort()).toEqual(['ada@example.org', 'grace@example.org']);
		expect(sent[0].subject).toBe('How was Dune?');
	});

	it('reminds only whoever still has not rated', async () => {
		await runRatingMails(db, OPENS, null, send);
		saveRating(db, { nightId, userId: grace, scoreX2: 14, comment: null, now: OPENS });
		sent = [];
		await runRatingMails(db, new Date(CLOSES.getTime() - DAY), null, send);
		expect(sent).toEqual([{ to: 'ada@example.org', subject: 'Rating for Dune closes tomorrow' }]);
	});

	it('sends only the open email when the window opens on its last day', async () => {
		const late = new Date(CLOSES.getTime() - 2 * HOUR);
		await runRatingMails(db, late, null, send);
		await runRatingMails(db, new Date(late.getTime() + HOUR), null, send);
		expect(sent.every((s) => s.subject === 'How was Dune?')).toBe(true);
		expect(sent).toHaveLength(2);
	});

	it('claims nothing while mail is not configured', async () => {
		mailConfigured = false;
		await runRatingMails(db, OPENS, null, send);
		expect(sent).toEqual([]);
		mailConfigured = true;
		await runRatingMails(db, OPENS, null, send);
		expect(sent).toHaveLength(2);
	});

	it('keeps sending when one recipient throws', async () => {
		const flaky = (to: string, subject: string) => {
			if (to === 'ada@example.org') throw new Error('smtp exploded');
			return send(to, subject);
		};
		await runRatingMails(db, OPENS, null, flaky);
		expect(sent.map((s) => s.to)).toEqual(['grace@example.org']);
	});
});
