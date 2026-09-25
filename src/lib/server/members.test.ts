import { beforeEach, describe, expect, it } from 'vitest';
import { eq, isNull } from 'drizzle-orm';
import { applyMigrations, createDb, type DB } from '$lib/server/db/client';
import { suggestions, users } from '$lib/server/db/schema';
import { createGroup } from '$lib/server/groups';
import { addSuggestion } from '$lib/server/suggestions';
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
		expect(moved).toBe(1);

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
		expect(reassignToFormerMember(db, ada)).toBe(0);
	});
});
