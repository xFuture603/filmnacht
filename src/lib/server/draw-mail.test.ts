import { beforeEach, describe, expect, it, vi } from 'vitest';
import { applyMigrations, createDb, type DB } from './db/client';
import { DEFAULT_GROUP_SETTINGS, groups } from './db/schema';
import { drawForNight, redraw, scheduleNight } from './nights';
import { addMember, createGroup, leaveGroup } from './groups';
import { setEmailLocale, setSetting } from './settings';
import { addSuggestion } from './suggestions';
import { createUser, setEmail } from './users';
import { eq } from 'drizzle-orm';
import { composeDrawMail, drawRecipients, notifyDraw } from './draw-mail';

let sent: Array<{ to: string; subject: string; body: string }> = [];
let throwing = false;
let mailConfigured = true;
let sendMailCalls = 0;

// Recorder mock, same shape as the pattern in admin.test.ts / reset.test.ts.
// A throwing variant is included on purpose: sendMail's own contract is that
// it never rejects, but notifyDraw must survive it anyway (spec §3).
vi.mock('./mail', () => ({
	isMailConfigured: () => mailConfigured,
	sendMail: (to: string, subject: string, body: string) => {
		sendMailCalls++;
		if (throwing) throw new Error('smtp exploded');
		sent.push({ to, subject, body });
		return Promise.resolve(true);
	}
}));

describe('composeDrawMail', () => {
	const base = {
		locale: 'en' as const,
		groupName: 'Filmnacht',
		when: 'Sunday, 1 March 2030 at 19:00',
		location: "Ada's place",
		film: { title: 'Dune', by: 'Grace', byFormer: false },
		surprise: false,
		redrawn: null as { byName: string; reason: string } | null,
		link: 'http://localhost/groups/g1/nights/n1'
	};

	it('names the group, the date, the place, the title, the suggester and the link', () => {
		const { subject, body } = composeDrawMail(base);
		expect(subject).toContain(base.when);
		expect(subject).toContain(base.groupName);
		expect(body).toContain(base.groupName);
		expect(body).toContain(base.when);
		expect(body).toContain(base.location);
		expect(body).toContain('Dune');
		expect(body).toContain('suggested by Grace');
		expect(body).toContain(base.link);
	});

	it('keeps the title and the suggester out of a surprise night', () => {
		const { subject, body } = composeDrawMail({ ...base, surprise: true });
		expect(subject).not.toContain('Dune');
		expect(subject).not.toContain('Grace');
		expect(body).not.toContain('Dune');
		expect(body).not.toContain('Grace');
		expect(body).toContain('stays a surprise');
	});

	it('names who re-drew and why', () => {
		const { body } = composeDrawMail({
			...base,
			redrawn: { byName: 'Ada', reason: 'wrong mood tonight' }
		});
		expect(body).toContain('Re-drawn by Ada');
		expect(body).toContain('wrong mood tonight');
	});

	it('still has no title on a re-drawn surprise night', () => {
		const { body } = composeDrawMail({
			...base,
			surprise: true,
			redrawn: { byName: 'Ada', reason: 'wrong mood tonight' }
		});
		expect(body).not.toContain('Dune');
		expect(body).toContain('Re-drawn by Ada');
	});

	it('produces German text', () => {
		const { subject, body } = composeDrawMail({ ...base, locale: 'de' });
		expect(subject).toContain('Film gezogen');
		expect(body).toContain('vorgeschlagen von Grace');
	});

	it('leaves no "undefined" and no empty line when there is no link', () => {
		const { body } = composeDrawMail({ ...base, link: null });
		expect(body).not.toContain('undefined');
		expect(body.split('\n\n').every((line) => line.trim().length > 0)).toBe(true);
	});

	it('drops the "suggested by" clause entirely for a wildcard film', () => {
		// suggestedBy IS NULL (PRD §6): a film belonging to nobody, so there is
		// nobody to name — and, unlike the former-member case, nobody to name as
		// "since left" either.
		const { body } = composeDrawMail({
			...base,
			film: { title: 'Dune', by: null, byFormer: false }
		});
		expect(body).toContain('Dune');
		expect(body).not.toContain('suggested by');
		expect(body).not.toContain('null');
		expect(body).not.toContain('undefined');
	});
});

describe('drawRecipients', () => {
	let db: DB;
	let groupId: string;
	let nightId: string;
	let ada: string;
	let grace: string;
	let mallory: string;

	beforeEach(() => {
		db = createDb(':memory:').db;
		applyMigrations(db);
		ada = createUser(db, {
			username: 'ada',
			displayName: 'Ada',
			passwordHash: 'scrypt$placeholder$placeholder'
		}).id;
		grace = createUser(db, {
			username: 'grace',
			displayName: 'Grace',
			passwordHash: 'scrypt$placeholder$placeholder'
		}).id;
		mallory = createUser(db, {
			username: 'mallory',
			displayName: 'Mallory',
			passwordHash: 'scrypt$placeholder$placeholder'
		}).id;
		setEmail(db, ada, 'ada@example.com');
		setEmail(db, grace, 'grace@example.com');
		// mallory keeps no email on purpose.
		groupId = createGroup(db, { name: 'Filmnacht', ownerId: ada });
		addMember(db, grace, groupId);
		addMember(db, mallory, groupId);
		nightId = scheduleNight(db, {
			groupId,
			userId: ada,
			scheduledAt: new Date('2030-01-01T19:00:00Z'),
			location: null
		});
	});

	it('is current members with an address, and only those', () => {
		expect(drawRecipients(db, nightId).sort()).toEqual(['ada@example.com', 'grace@example.com']);
	});

	it('excludes a departed member even though they have an address', () => {
		leaveGroup(db, grace, groupId);
		expect(drawRecipients(db, nightId)).toEqual(['ada@example.com']);
	});
});

describe('notifyDraw', () => {
	let db: DB;
	let groupId: string;
	let nightId: string;
	let ada: string;
	let grace: string;

	beforeEach(() => {
		sent = [];
		throwing = false;
		mailConfigured = true;
		sendMailCalls = 0;
		db = createDb(':memory:').db;
		applyMigrations(db);
		ada = createUser(db, {
			username: 'ada',
			displayName: 'Ada',
			passwordHash: 'scrypt$placeholder$placeholder'
		}).id;
		grace = createUser(db, {
			username: 'grace',
			displayName: 'Grace',
			passwordHash: 'scrypt$placeholder$placeholder'
		}).id;
		setEmail(db, ada, 'ada@example.com');
		setEmail(db, grace, 'grace@example.com');
		groupId = createGroup(db, { name: 'Filmnacht', ownerId: ada });
		addMember(db, grace, groupId);
		setSetting(db, 'timezone', 'UTC');
		addSuggestion(db, {
			groupId,
			userId: grace,
			movie: { title: 'Dune' },
			settings: DEFAULT_GROUP_SETTINGS
		});
		nightId = scheduleNight(db, {
			groupId,
			userId: ada,
			scheduledAt: new Date('2030-03-01T19:00:00Z'),
			location: null
		});
		drawForNight(db, nightId, ada);
	});

	async function tick() {
		await new Promise((resolve) => setTimeout(resolve, 0));
	}

	it('sends one mail per current member with an address, all with the same subject', async () => {
		notifyDraw(db, nightId, 'http://localhost');
		await tick();

		expect(sent).toHaveLength(2);
		expect(sent.map((s) => s.to).sort()).toEqual(['ada@example.com', 'grace@example.com']);
		expect(new Set(sent.map((s) => s.subject)).size).toBe(1);
		expect(sent[0].body).toContain('Dune');
		expect(sent[0].body).toContain(`http://localhost/groups/${groupId}/nights/${nightId}`);
	});

	it('leaves the film and suggester out when the group keeps it a surprise', async () => {
		db.update(groups)
			.set({ settings: { ...DEFAULT_GROUP_SETTINGS, resultVisible: 'on_night' } })
			.where(eq(groups.id, groupId))
			.run();

		notifyDraw(db, nightId, 'http://localhost');
		await tick();

		// Asserted first and unconditionally: a `sent` that ended up empty (say,
		// because `drawRecipients` silently broke) must fail this test rather
		// than vacuously pass an empty loop below.
		expect(sent).toHaveLength(2);
		for (const mail of sent) {
			expect(mail.subject).not.toContain('Dune');
			expect(mail.body).not.toContain('Dune');
			expect(mail.body).not.toContain('Grace');
			expect(mail.body).toContain('stays a surprise');
		}
	});

	it('reveals the film once the night has started, even with resultVisible: on_night', async () => {
		// Same rule as isResultVisible (src/lib/server/nights.ts): once the
		// night starts, EVERYONE sees the film regardless of the setting — a
		// manual draw made late is not still a surprise to anybody.
		db.update(groups)
			.set({ settings: { ...DEFAULT_GROUP_SETTINGS, resultVisible: 'on_night' } })
			.where(eq(groups.id, groupId))
			.run();

		addSuggestion(db, {
			groupId,
			userId: grace,
			movie: { title: 'Arrival' },
			settings: DEFAULT_GROUP_SETTINGS
		});
		const pastNightId = scheduleNight(db, {
			groupId,
			userId: ada,
			scheduledAt: new Date(Date.now() - 60_000),
			location: null
		});
		drawForNight(db, pastNightId, ada);

		notifyDraw(db, pastNightId, 'http://localhost');
		await tick();

		expect(sent).toHaveLength(2);
		for (const mail of sent) {
			expect(mail.body).toContain('Arrival');
			expect(mail.body).toContain('suggested by Grace');
		}
	});

	it('says who re-drew and why once the night has been re-drawn', async () => {
		addSuggestion(db, {
			groupId,
			userId: ada,
			movie: { title: 'Arrival' },
			settings: DEFAULT_GROUP_SETTINGS
		});
		redraw(db, nightId, ada, 'wrong mood tonight');

		notifyDraw(db, nightId, 'http://localhost');
		await tick();

		expect(sent[0].body).toContain('Re-drawn by Ada');
		expect(sent[0].body).toContain('wrong mood tonight');
	});

	it('uses the instance email language', async () => {
		setEmailLocale(db, 'de');
		notifyDraw(db, nightId, 'http://localhost');
		await tick();

		expect(sent[0].subject).toContain('Film gezogen');
	});

	it('never throws, even when every send throws', async () => {
		// `expect(...).not.toThrow()` alone is close to a tautology here: the
		// throw happens inside the setTimeout callback, asynchronously, so
		// notifyDraw's own synchronous call never throws regardless of whether
		// the callback body catches anything at all — an uncaught exception in
		// there would just surface later as an unhandled rejection, not here.
		// The real claim is that each send is caught in isolation and logged,
		// so the console.error call is the one fact that actually distinguishes
		// "survived" from "silently escaped uncaught": it only fires this way
		// when the per-recipient catch produced two recorded failures.
		const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
		throwing = true;
		expect(() => notifyDraw(db, nightId, 'http://localhost')).not.toThrow();
		await tick();
		expect(sent).toHaveLength(0);
		expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('2/2 failed to send'));
	});

	it('leaves out the link when no origin is given', async () => {
		notifyDraw(db, nightId, null);
		await tick();

		expect(sent[0].body).not.toContain('undefined');
		expect(sent[0].body).not.toContain('http');
	});

	it('does nothing, and never calls sendMail, when this instance has no mail set up', async () => {
		// Every recipient would fail identically (sendMail's own "not
		// configured" contract), which is not a per-draw failure worth an
		// operator's attention — logging "N/N failed to send" on every
		// automatic draw of an instance that never set up mail is just noise.
		mailConfigured = false;
		notifyDraw(db, nightId, 'http://localhost');
		await tick();

		expect(sendMailCalls).toBe(0);
		expect(sent).toHaveLength(0);
	});
});
