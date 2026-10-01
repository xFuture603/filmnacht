import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { applyMigrations, createDb, type DB } from '$lib/server/db/client';
import { DEFAULT_GROUP_SETTINGS, movieNights } from '$lib/server/db/schema';
import { addMember, createGroup, leaveGroup } from '$lib/server/groups';
import { addSuggestion, listPool } from '$lib/server/suggestions';
import { createUser } from '$lib/server/users';
import type { DrawLogEntry } from './draw';
import { reassignToFormerMember } from './members';
import {
	LOCATION_MAX,
	candidatesFor,
	isResultVisible,
	unrevealedDrawnIds,
	cancelNight,
	drawForNight,
	drawNight,
	listNights,
	markWatched,
	nightDetail,
	redraw,
	respond,
	scheduleNight
} from './nights';

let db: DB;
let ada: string;
let grace: string;
let groupId: string;
const LATER = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

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
	groupId = createGroup(db, { name: 'Filmnacht', ownerId: ada });
	addMember(db, grace, groupId);
});

describe('scheduleNight', () => {
	it('schedules a night the group can see', () => {
		const id = scheduleNight(db, {
			groupId,
			userId: ada,
			scheduledAt: LATER,
			location: "Ada's flat"
		});
		const nights = listNights(db, groupId);
		expect(nights).toHaveLength(1);
		expect(nights[0].id).toBe(id);
		expect(nights[0].status).toBe('scheduled');
		expect(nights[0].location).toBe("Ada's flat");
	});

	it('refuses a member who does not own the group', () => {
		expect(() =>
			scheduleNight(db, { groupId, userId: grace, scheduledAt: LATER, location: null })
		).toThrow();
	});

	it('refuses somebody who is not in the group at all', () => {
		const mallory = createUser(db, {
			username: 'mallory',
			displayName: 'Mallory',
			passwordHash: 'scrypt$placeholder$placeholder'
		}).id;
		expect(() =>
			scheduleNight(db, { groupId, userId: mallory, scheduledAt: LATER, location: null })
		).toThrow();
	});

	it('stores the moment in UTC', () => {
		const id = scheduleNight(db, { groupId, userId: ada, scheduledAt: LATER, location: null });
		const night = nightDetail(db, id, ada);
		// Round-trips to the same instant. The display timezone is a render-time
		// concern; the column is UTC (PRD §6).
		expect(night?.scheduledAt.getTime()).toBe(Math.floor(LATER.getTime() / 1000) * 1000);
	});
});

describe('respond', () => {
	it('records a response and counts it', () => {
		const id = scheduleNight(db, { groupId, userId: ada, scheduledAt: LATER, location: null });
		respond(db, id, grace, 'yes');
		expect(listNights(db, groupId)[0].yes).toBe(1);
		expect(nightDetail(db, id, grace)?.myResponse).toBe('yes');
	});

	it('replaces an earlier response instead of adding a second', () => {
		const id = scheduleNight(db, { groupId, userId: ada, scheduledAt: LATER, location: null });
		respond(db, id, grace, 'yes');
		respond(db, id, grace, 'no');
		const nights = listNights(db, groupId);
		expect(nights[0].yes).toBe(0);
		expect(nights[0].no).toBe(1);
		expect(nightDetail(db, id, grace)?.responses).toHaveLength(1);
	});

	it('refuses a response from outside the group', () => {
		const mallory = createUser(db, {
			username: 'mallory',
			displayName: 'Mallory',
			passwordHash: 'scrypt$placeholder$placeholder'
		}).id;
		const id = scheduleNight(db, { groupId, userId: ada, scheduledAt: LATER, location: null });
		expect(() => respond(db, id, mallory, 'yes')).toThrow();
	});
});

describe('nightDetail', () => {
	it('returns nothing for a viewer outside the group', () => {
		const mallory = createUser(db, {
			username: 'mallory',
			displayName: 'Mallory',
			passwordHash: 'scrypt$placeholder$placeholder'
		}).id;
		const id = scheduleNight(db, { groupId, userId: ada, scheduledAt: LATER, location: null });
		expect(nightDetail(db, id, mallory)).toBeNull();
	});

	it('returns nothing for a night that does not exist', () => {
		// A real night must exist in the table so a WHERE clause that forgot to
		// filter by id (and so returned the first row) would be caught here.
		scheduleNight(db, { groupId, userId: ada, scheduledAt: LATER, location: null });
		expect(nightDetail(db, 'no-such-night', ada)).toBeNull();
	});
});

describe('input bounds', () => {
	it('refuses a location past the limit', () => {
		expect(() =>
			scheduleNight(db, {
				groupId,
				userId: ada,
				scheduledAt: LATER,
				location: 'x'.repeat(LOCATION_MAX + 1)
			})
		).toThrow();
	});
});

describe('drawForNight', () => {
	function openFilm(userId: string, title: string) {
		return addSuggestion(db, {
			groupId,
			userId,
			movie: { title },
			settings: DEFAULT_GROUP_SETTINGS
		});
	}

	it('draws the only suggestion and says it did not roll dice', () => {
		openFilm(ada, 'Dune');
		const id = scheduleNight(db, { groupId, userId: ada, scheduledAt: LATER, location: null });
		const result = drawForNight(db, id, ada);
		expect(result).toMatchObject({ ok: true, title: 'Dune', onlyCandidate: true });
	});

	it('closes the pool for that night and marks the suggestion drawn', () => {
		openFilm(ada, 'Dune');
		const id = scheduleNight(db, { groupId, userId: ada, scheduledAt: LATER, location: null });
		drawForNight(db, id, ada);
		expect(nightDetail(db, id, ada)?.status).toBe('drawn');
		expect(listPool(db, groupId, ada).find((e) => e.title === 'Dune')?.status).toBe('drawn');
	});

	it('refuses when nobody has suggested anything', () => {
		const id = scheduleNight(db, { groupId, userId: ada, scheduledAt: LATER, location: null });
		expect(drawForNight(db, id, ada)).toEqual({ ok: false, reason: 'no_candidates' });
	});

	it('refuses a member who does not own the group', () => {
		openFilm(ada, 'Dune');
		const id = scheduleNight(db, { groupId, userId: ada, scheduledAt: LATER, location: null });
		expect(() => drawForNight(db, id, grace)).toThrow();
	});

	it('draws once when two owners press the button at the same moment', () => {
		// Review Focus 1. The symptom of getting this wrong is not an error, it is
		// a group arguing about which film was really drawn.
		openFilm(ada, 'Dune');
		openFilm(grace, 'Arrival');
		const id = scheduleNight(db, { groupId, userId: ada, scheduledAt: LATER, location: null });

		const first = drawForNight(db, id, ada);
		const second = drawForNight(db, id, ada);

		expect(first.ok).toBe(true);
		expect(second).toEqual({ ok: false, reason: 'not_scheduled' });
		// And exactly one film left the pool.
		const drawn = listPool(db, groupId, ada).filter((e) => e.status === 'drawn');
		expect(drawn).toHaveLength(1);
	});

	it('records every candidate and the seed in an append-only log', () => {
		openFilm(ada, 'Dune');
		openFilm(grace, 'Arrival');
		const id = scheduleNight(db, { groupId, userId: ada, scheduledAt: LATER, location: null });
		drawForNight(db, id, ada);

		const row = db
			.select({ log: movieNights.drawLog, seed: movieNights.drawSeed })
			.from(movieNights)
			.where(eq(movieNights.id, id))
			.get();
		const log = row?.log as DrawLogEntry[];
		expect(log).toHaveLength(1);
		expect(log[0].candidates).toHaveLength(2);
		expect(log[0].seed).toBeGreaterThanOrEqual(0);
		expect(String(row?.seed)).toBe(String(log[0].seed));
	});

	it('leaves a departed member’s film in the pool but out of the draw', () => {
		// Review Focus 2. The draw draws people; somebody who left is not a person
		// who can take a turn. Their film stays visible as history.
		openFilm(grace, 'Arrival');
		leaveGroup(db, grace, groupId);
		const id = scheduleNight(db, { groupId, userId: ada, scheduledAt: LATER, location: null });

		expect(drawForNight(db, id, ada)).toEqual({ ok: false, reason: 'no_candidates' });
		expect(listPool(db, groupId, ada).map((e) => e.title)).toContain('Arrival');
	});

	it('counts only watched nights in the fairness window', () => {
		// The Global Constraint, and the easiest thing here to get wrong. A night
		// that was drawn but never watched must not cost anybody their turn.
		openFilm(ada, 'Dune');
		const drawnOnly = scheduleNight(db, {
			groupId,
			userId: ada,
			scheduledAt: LATER,
			location: null
		});
		drawForNight(db, drawnOnly, ada);

		// Ada's film is drawn but the night is not watched, so her weight must
		// still be the maximum.
		openFilm(ada, 'Arrival');
		expect(candidatesFor(db, groupId).find((c) => c.userId === ada)?.watchedInWindow).toBe(0);
	});

	it('defines every weight in a group with fewer than ten nights', () => {
		// Review Focus 3. A group in its first month has three nights, not ten.
		openFilm(ada, 'Dune');
		const candidates = candidatesFor(db, groupId);
		expect(candidates).toHaveLength(1);
		expect(Number.isFinite(candidates[0].watchedInWindow)).toBe(true);
	});
});

describe('drawNight', () => {
	it('draws with by: null and no owner check', () => {
		addSuggestion(db, {
			groupId,
			userId: ada,
			movie: { title: 'Dune' },
			settings: DEFAULT_GROUP_SETTINGS
		});
		const id = scheduleNight(db, { groupId, userId: ada, scheduledAt: LATER, location: null });

		const outcome = drawNight(db, id, null);

		expect(outcome).toMatchObject({ ok: true, title: 'Dune' });
		const log = db
			.select({ log: movieNights.drawLog })
			.from(movieNights)
			.where(eq(movieNights.id, id))
			.get()?.log as DrawLogEntry[];
		expect(log[0].by).toBeNull();
	});
});

describe('cancelNight', () => {
	it('releases the drawn film back into the pool', () => {
		addSuggestion(db, {
			groupId,
			userId: ada,
			movie: { title: 'Dune' },
			settings: DEFAULT_GROUP_SETTINGS
		});
		const id = scheduleNight(db, { groupId, userId: ada, scheduledAt: LATER, location: null });
		drawForNight(db, id, ada);

		expect(cancelNight(db, id, ada)).toBe(true);
		expect(nightDetail(db, id, ada)?.status).toBe('cancelled');
		expect(listPool(db, groupId, ada).find((e) => e.title === 'Dune')?.status).toBe('open');
	});

	it('does not cost the member their turn', () => {
		// PRD §6, in as many words: "A night that never happened must not cost a
		// member their turn."
		addSuggestion(db, {
			groupId,
			userId: ada,
			movie: { title: 'Dune' },
			settings: DEFAULT_GROUP_SETTINGS
		});
		const id = scheduleNight(db, { groupId, userId: ada, scheduledAt: LATER, location: null });
		drawForNight(db, id, ada);
		cancelNight(db, id, ada);

		expect(candidatesFor(db, groupId).find((c) => c.userId === ada)?.watchedInWindow).toBe(0);
	});

	it('refuses a non-owner', () => {
		const id = scheduleNight(db, { groupId, userId: ada, scheduledAt: LATER, location: null });
		expect(() => cancelNight(db, id, grace)).toThrow();
	});

	it('refuses a night that has already been watched, leaving the film alone', () => {
		// A watched night's film must never be released — the fairness window's
		// per-suggestion counting depends on it.
		addSuggestion(db, {
			groupId,
			userId: ada,
			movie: { title: 'Dune' },
			settings: DEFAULT_GROUP_SETTINGS
		});
		const id = scheduleNight(db, { groupId, userId: ada, scheduledAt: LATER, location: null });
		drawForNight(db, id, ada);
		markWatched(db, id, ada);

		expect(cancelNight(db, id, ada)).toBe(false);
		expect(nightDetail(db, id, ada)?.status).toBe('watched');
		expect(listPool(db, groupId, ada).find((e) => e.title === 'Dune')?.status).toBe('drawn');
	});
});

describe('markWatched', () => {
	it('moves the night to watched and starts counting the film', () => {
		addSuggestion(db, {
			groupId,
			userId: ada,
			movie: { title: 'Dune' },
			settings: DEFAULT_GROUP_SETTINGS
		});
		const id = scheduleNight(db, { groupId, userId: ada, scheduledAt: LATER, location: null });
		drawForNight(db, id, ada);

		expect(markWatched(db, id, ada)).toBe(true);
		expect(nightDetail(db, id, ada)?.status).toBe('watched');

		addSuggestion(db, {
			groupId,
			userId: ada,
			movie: { title: 'Arrival' },
			settings: DEFAULT_GROUP_SETTINGS
		});
		expect(candidatesFor(db, groupId).find((c) => c.userId === ada)?.watchedInWindow).toBe(1);
	});

	it('refuses a night with no film drawn', () => {
		const id = scheduleNight(db, { groupId, userId: ada, scheduledAt: LATER, location: null });
		expect(markWatched(db, id, ada)).toBe(false);
		expect(nightDetail(db, id, ada)?.status).toBe('scheduled');
	});
});

describe('redraw', () => {
	it('releases the first film, picks again, and keeps both in the log', () => {
		addSuggestion(db, {
			groupId,
			userId: ada,
			movie: { title: 'Dune' },
			settings: DEFAULT_GROUP_SETTINGS
		});
		addSuggestion(db, {
			groupId,
			userId: grace,
			movie: { title: 'Arrival' },
			settings: DEFAULT_GROUP_SETTINGS
		});
		const id = scheduleNight(db, { groupId, userId: ada, scheduledAt: LATER, location: null });
		drawForNight(db, id, ada);

		const again = redraw(db, id, ada, 'available nowhere');
		expect(again.ok).toBe(true);

		const log = db
			.select({ log: movieNights.drawLog })
			.from(movieNights)
			.where(eq(movieNights.id, id))
			.get()?.log as DrawLogEntry[];
		expect(log).toHaveLength(2);
		expect(log[1].reason).toBe('available nowhere');
		// Exactly one film is drawn: the first was released.
		expect(listPool(db, groupId, ada).filter((e) => e.status === 'drawn')).toHaveLength(1);
	});

	it('permits the override exactly once', () => {
		for (const title of ['Dune', 'Arrival', 'Solaris']) {
			addSuggestion(db, {
				groupId,
				userId: ada,
				movie: { title },
				settings: DEFAULT_GROUP_SETTINGS
			});
		}
		const id = scheduleNight(db, { groupId, userId: ada, scheduledAt: LATER, location: null });
		drawForNight(db, id, ada);
		expect(redraw(db, id, ada, 'first reason').ok).toBe(true);
		expect(redraw(db, id, ada, 'second reason')).toEqual({ ok: false, reason: 'redraw_used' });
	});

	it('refuses when only one film exists rather than appearing to reroll', () => {
		// Review Focus 4. Re-drawing a one-film pool can only return that film, and
		// pretending otherwise is worse than saying so.
		addSuggestion(db, {
			groupId,
			userId: ada,
			movie: { title: 'Dune' },
			settings: DEFAULT_GROUP_SETTINGS
		});
		const id = scheduleNight(db, { groupId, userId: ada, scheduledAt: LATER, location: null });
		drawForNight(db, id, ada);
		expect(redraw(db, id, ada, 'nope')).toEqual({ ok: false, reason: 'sole_suggestion' });
	});

	it('refuses a night that has already been watched', () => {
		// A watched night's film must never be released, so a re-draw is refused
		// the same as any other transition off 'watched'.
		addSuggestion(db, {
			groupId,
			userId: ada,
			movie: { title: 'Dune' },
			settings: DEFAULT_GROUP_SETTINGS
		});
		addSuggestion(db, {
			groupId,
			userId: grace,
			movie: { title: 'Arrival' },
			settings: DEFAULT_GROUP_SETTINGS
		});
		const id = scheduleNight(db, { groupId, userId: ada, scheduledAt: LATER, location: null });
		drawForNight(db, id, ada);
		markWatched(db, id, ada);

		expect(redraw(db, id, ada, 'nope')).toEqual({ ok: false, reason: 'not_scheduled' });
		expect(nightDetail(db, id, ada)?.status).toBe('watched');
	});

	it('rolls back completely when the release leaves nothing to redraw into', () => {
		// R3 (controller ruling): a re-draw that fails after changing state must
		// undo everything it did. Grace leaves after the first draw, so once her
		// film is released it is no longer eligible either — the redraw must fail
		// and leave the night exactly as it was: 'drawn', same film, log of 1.
		addSuggestion(db, {
			groupId,
			userId: grace,
			movie: { title: 'Arrival' },
			settings: DEFAULT_GROUP_SETTINGS
		});
		const id = scheduleNight(db, { groupId, userId: ada, scheduledAt: LATER, location: null });
		drawForNight(db, id, ada);
		leaveGroup(db, grace, groupId);

		expect(redraw(db, id, ada, 'no longer works')).toEqual({
			ok: false,
			reason: 'sole_suggestion'
		});

		const detail = nightDetail(db, id, ada);
		expect(detail?.status).toBe('drawn');
		expect(detail?.drawnTitle).toBe('Arrival');

		const log = db
			.select({ log: movieNights.drawLog })
			.from(movieNights)
			.where(eq(movieNights.id, id))
			.get()?.log as DrawLogEntry[];
		expect(log).toHaveLength(1);
	});
	it('never re-draws the film it just released', () => {
		// R12. Two films, equal weights: without the exclusion the re-draw returns
		// the released film half the time, so thirty rounds all but guarantee it.
		addSuggestion(db, {
			groupId,
			userId: ada,
			movie: { title: 'Dune' },
			settings: DEFAULT_GROUP_SETTINGS
		});
		addSuggestion(db, {
			groupId,
			userId: grace,
			movie: { title: 'Arrival' },
			settings: DEFAULT_GROUP_SETTINGS
		});
		for (let i = 0; i < 30; i++) {
			const id = scheduleNight(db, { groupId, userId: ada, scheduledAt: LATER, location: null });
			const first = drawForNight(db, id, ada);
			const again = redraw(db, id, ada, 'seen it');
			if (!first.ok || !again.ok) throw new Error('draw failed');
			expect(again.suggestionId).not.toBe(first.suggestionId);
			// Cancelling releases the film and costs nobody a turn: a clean next round.
			cancelNight(db, id, ada);
		}
	});

	it('records who drew each time and leaves the first result intact', () => {
		// R13.
		addSuggestion(db, {
			groupId,
			userId: ada,
			movie: { title: 'Dune' },
			settings: DEFAULT_GROUP_SETTINGS
		});
		addSuggestion(db, {
			groupId,
			userId: grace,
			movie: { title: 'Arrival' },
			settings: DEFAULT_GROUP_SETTINGS
		});
		const id = scheduleNight(db, { groupId, userId: ada, scheduledAt: LATER, location: null });
		const first = drawForNight(db, id, ada);
		if (!first.ok) throw new Error('draw failed');
		expect(nightDetail(db, id, grace)?.redrawn).toBeNull();

		redraw(db, id, ada, 'seen it');
		const log = db
			.select({ log: movieNights.drawLog })
			.from(movieNights)
			.where(eq(movieNights.id, id))
			.get()?.log as DrawLogEntry[];
		expect(log.map((e) => e.by)).toEqual([ada, ada]);
		expect(log[0].pickedSuggestionId).toBe(first.suggestionId);
		expect(log[0].reason).toBeUndefined();
		expect(nightDetail(db, id, grace)?.redrawn).toEqual({ byName: 'Ada', reason: 'seen it' });
	});
});

describe('what the night page is told about the draw', () => {
	function film(userId: string, title: string) {
		addSuggestion(db, { groupId, userId, movie: { title }, settings: DEFAULT_GROUP_SETTINGS });
	}

	it('says a lone suggestion won without dice, and not when there was a choice', () => {
		film(ada, 'Dune');
		const lone = scheduleNight(db, { groupId, userId: ada, scheduledAt: LATER, location: null });
		drawForNight(db, lone, ada);
		expect(nightDetail(db, lone, ada)?.onlyCandidate).toBe(true);

		film(ada, 'Arrival');
		film(ada, 'Solaris');
		const choice = scheduleNight(db, { groupId, userId: ada, scheduledAt: LATER, location: null });
		drawForNight(db, choice, ada);
		// One person with two films is still a roll of the dice.
		expect(nightDetail(db, choice, ada)?.onlyCandidate).toBe(false);
	});

	it('marks a film whose suggester has since become the former-member placeholder', () => {
		film(grace, 'Arrival');
		const id = scheduleNight(db, { groupId, userId: ada, scheduledAt: LATER, location: null });
		drawForNight(db, id, ada);
		expect(nightDetail(db, id, ada)?.drawnByFormer).toBe(false);

		reassignToFormerMember(db, grace);
		expect(nightDetail(db, id, ada)?.drawnByFormer).toBe(true);
	});

	it('reports when the one permitted re-draw is spent', () => {
		film(ada, 'Dune');
		film(grace, 'Arrival');
		const id = scheduleNight(db, { groupId, userId: ada, scheduledAt: LATER, location: null });
		drawForNight(db, id, ada);
		expect(nightDetail(db, id, ada)?.redrawUsed).toBe(false);
		redraw(db, id, ada, 'seen it');
		expect(nightDetail(db, id, ada)?.redrawUsed).toBe(true);
	});
});

describe('isResultVisible', () => {
	const at = new Date('2030-01-01T20:00:00Z');
	it('always shows the film when the group reveals immediately', () => {
		expect(isResultVisible(DEFAULT_GROUP_SETTINGS, at, new Date('2029-12-31T00:00:00Z'))).toBe(
			true
		);
	});
	it('hides it until the night when the group keeps it a surprise', () => {
		const settings = { ...DEFAULT_GROUP_SETTINGS, resultVisible: 'on_night' as const };
		expect(isResultVisible(settings, at, new Date('2030-01-01T19:59:59Z'))).toBe(false);
		expect(isResultVisible(settings, at, at)).toBe(true);
	});
});

describe('unrevealedDrawnIds', () => {
	it('lists films drawn for nights still to come, and only those', () => {
		addSuggestion(db, {
			groupId,
			userId: ada,
			movie: { title: 'Dune' },
			settings: DEFAULT_GROUP_SETTINGS
		});
		const future = scheduleNight(db, { groupId, userId: ada, scheduledAt: LATER, location: null });
		const drawn = drawForNight(db, future, ada);
		if (!drawn.ok) throw new Error('draw failed');

		expect([...unrevealedDrawnIds(db, groupId, new Date())]).toEqual([drawn.suggestionId]);
		expect(unrevealedDrawnIds(db, groupId, new Date(LATER.getTime() + 1000)).size).toBe(0);
	});

	it('keeps a film hidden when its night is marked watched before it starts', () => {
		addSuggestion(db, {
			groupId,
			userId: ada,
			movie: { title: 'Dune' },
			settings: DEFAULT_GROUP_SETTINGS
		});
		const future = scheduleNight(db, { groupId, userId: ada, scheduledAt: LATER, location: null });
		const drawn = drawForNight(db, future, ada);
		if (!drawn.ok) throw new Error('draw failed');
		markWatched(db, future, ada);

		expect([...unrevealedDrawnIds(db, groupId, new Date())]).toEqual([drawn.suggestionId]);
	});
});
