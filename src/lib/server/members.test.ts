import { beforeEach, describe, expect, it } from 'vitest';
import { eq, isNull } from 'drizzle-orm';
import { applyMigrations, createDb, type DB } from '$lib/server/db/client';
import { ratings, suggestions, users } from '$lib/server/db/schema';
import { createGroup } from '$lib/server/groups';
import { addSuggestion } from '$lib/server/suggestions';
import { scheduleNight } from '$lib/server/nights';
import { DEFAULT_GROUP_SETTINGS } from '$lib/server/db/schema';
import { createUser } from '$lib/server/users';
import { FORMER_MEMBER_USERNAME, formerMemberId, reassignToFormerMember } from './members';

let db: DB;
let ada: string;
let groupId: string;

beforeEach(() => {
	db = createDb(':memory:').db;
	applyMigrations(db);
	ada = createUser(db, {
		username: 'ada',
		displayName: 'Ada',
		passwordHash: 'scrypt$placeholder$placeholder'
	}).id;
	groupId = createGroup(db, { name: 'Filmnacht', ownerId: ada });
});

describe('the former-member placeholder', () => {
	it('is created once and reused', () => {
		const first = formerMemberId(db);
		const second = formerMemberId(db);
		expect(second).toBe(first);
		const rows = db
			.select({ id: users.id })
			.from(users)
			.where(eq(users.username, FORMER_MEMBER_USERNAME))
			.all();
		expect(rows).toHaveLength(1);
	});

	it('cannot be signed in to', async () => {
		// It exists to own orphaned rows, not to be an account. A usable password
		// here would be a permanent back door with a guessable username.
		const { verifyPassword } = await import('$lib/server/auth/password');
		const id = formerMemberId(db);
		const row = db.select({ hash: users.passwordHash }).from(users).where(eq(users.id, id)).get();
		expect(await verifyPassword('', row?.hash ?? null)).toBe(false);
		expect(await verifyPassword('former-member', row?.hash ?? null)).toBe(false);
	});

	it('takes over a departing member’s suggestions without making them wildcards', () => {
		addSuggestion(db, {
			groupId,
			userId: ada,
			movie: { title: 'Dune', year: 2021 },
			settings: DEFAULT_GROUP_SETTINGS
		});

		const moved = reassignToFormerMember(db, ada);
		expect(moved).toEqual({ suggestions: 1, ratings: 0 });

		const placeholder = formerMemberId(db);
		const mine = db
			.select({ id: suggestions.id })
			.from(suggestions)
			.where(eq(suggestions.suggestedBy, placeholder))
			.all();
		expect(mine).toHaveLength(1);

		// The distinction this whole task exists for: not a wildcard.
		const wildcards = db
			.select({ id: suggestions.id })
			.from(suggestions)
			.where(isNull(suggestions.suggestedBy))
			.all();
		expect(wildcards).toHaveLength(0);
	});

	it('leaves other members’ suggestions alone', () => {
		const grace = createUser(db, {
			username: 'grace',
			displayName: 'Grace',
			passwordHash: 'scrypt$placeholder$placeholder'
		}).id;
		addSuggestion(db, {
			groupId,
			userId: ada,
			movie: { title: 'Dune', year: 2021 },
			settings: DEFAULT_GROUP_SETTINGS
		});
		addSuggestion(db, {
			groupId,
			userId: grace,
			movie: { title: 'Arrival', year: 2016 },
			settings: DEFAULT_GROUP_SETTINGS
		});

		reassignToFormerMember(db, ada);

		const stillGrace = db
			.select({ id: suggestions.id })
			.from(suggestions)
			.where(eq(suggestions.suggestedBy, grace))
			.all();
		expect(stillGrace).toHaveLength(1);
	});

	it('reassigns nothing for a member with no suggestions', () => {
		expect(reassignToFormerMember(db, ada)).toEqual({ suggestions: 0, ratings: 0 });
	});

	it('takes over a departing member’s ratings, letting the account then be deleted', () => {
		// Grace, not the group owner, rates: so the sole row referencing her is
		// the rating, and the delete below can only be refused by that FK.
		const grace = createUser(db, {
			username: 'grace',
			displayName: 'Grace',
			passwordHash: 'scrypt$placeholder$placeholder'
		}).id;
		const nightId = scheduleNight(db, {
			groupId,
			userId: ada,
			scheduledAt: new Date(),
			location: null
		});
		db.insert(ratings).values({ movieNightId: nightId, userId: grace, scoreX2: 16 }).run();

		expect(() => db.delete(users).where(eq(users.id, grace)).run()).toThrow(/FOREIGN KEY/);

		const moved = reassignToFormerMember(db, grace);
		expect(moved).toEqual({ suggestions: 0, ratings: 1 });

		const placeholder = formerMemberId(db);
		const rating = db
			.select({ userId: ratings.userId })
			.from(ratings)
			.where(eq(ratings.movieNightId, nightId))
			.get();
		expect(rating).toEqual({ userId: placeholder });

		expect(() => db.delete(users).where(eq(users.id, grace)).run()).not.toThrow();
	});

	it('reassigns two departed members who rated the same night without colliding (R2)', () => {
		// The unique index that used to sit on (movie_night_id, user_id) made this
		// impossible: both ratings end up owned by the one placeholder row, so the
		// second reassignment collided with the first on that same night.
		const grace = createUser(db, {
			username: 'grace',
			displayName: 'Grace',
			passwordHash: 'scrypt$placeholder$placeholder'
		}).id;
		const alan = createUser(db, {
			username: 'alan',
			displayName: 'Alan',
			passwordHash: 'scrypt$placeholder$placeholder'
		}).id;
		const nightId = scheduleNight(db, {
			groupId,
			userId: ada,
			scheduledAt: new Date(),
			location: null
		});
		db.insert(ratings).values({ movieNightId: nightId, userId: grace, scoreX2: 16 }).run();
		db.insert(ratings).values({ movieNightId: nightId, userId: alan, scoreX2: 12 }).run();

		expect(reassignToFormerMember(db, grace)).toEqual({ suggestions: 0, ratings: 1 });
		expect(reassignToFormerMember(db, alan)).toEqual({ suggestions: 0, ratings: 1 });

		const placeholder = formerMemberId(db);
		const rows = db
			.select({ userId: ratings.userId })
			.from(ratings)
			.where(eq(ratings.movieNightId, nightId))
			.all();
		expect(rows).toHaveLength(2);
		expect(rows.every((r) => r.userId === placeholder)).toBe(true);
	});
});
