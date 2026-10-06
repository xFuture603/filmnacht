import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { applyMigrations, createDb, type DB } from './db/client';
import { DEFAULT_GROUP_SETTINGS, movieNights, suggestions, users } from './db/schema';
import { addMember, createGroup, leaveGroup } from './groups';
import { cancelNight, drawForNight, markWatched, scheduleNight } from './nights';
import { saveRating } from './ratings';
import { addSuggestion } from './suggestions';
import { createUser, setEmail } from './users';
import { claimRatingMail, dueRatingMails, ratingMailInfo, ratingRecipients } from './rating-mail';

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
