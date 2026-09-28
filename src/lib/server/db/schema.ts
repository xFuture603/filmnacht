import { integer, real, sqliteTable, text, unique } from 'drizzle-orm/sqlite-core';

const uuid = () =>
	text('id')
		.primaryKey()
		.$defaultFn(() => crypto.randomUUID());

const createdAt = () =>
	integer('created_at', { mode: 'timestamp' })
		.notNull()
		.$defaultFn(() => new Date());

/** PRD §4 group settings table. Stored as JSON so adding one costs no migration. */
export type GroupSettings = {
	maxOpenSuggestions: number;
	drawMode: 'fairness' | 'uniform';
	resultVisible: 'immediately' | 'on_night';
	nightEndsAfterMinutes: number;
	ratingWindowDays: number;
	/** Draw automatically ahead of the night, instead of waiting for the owner. */
	autoDraw: boolean;
	/** How many hours before the night the automatic draw fires. */
	autoDrawHoursBefore: number;
};

export const DEFAULT_GROUP_SETTINGS: GroupSettings = {
	maxOpenSuggestions: 3,
	drawMode: 'fairness',
	resultVisible: 'immediately',
	nightEndsAfterMinutes: 180,
	ratingWindowDays: 7,
	autoDraw: false,
	autoDrawHoursBefore: 24
};

export const users = sqliteTable('users', {
	id: uuid(),
	displayName: text('display_name').notNull(),
	avatarUrl: text('avatar_url'),
	/**
	 * Optional forever (PRD §9): a member who sets none loses only the emailed
	 * reset path. Unique because Plan 4 has to resolve an address back to exactly
	 * one account to send that reset to — two accounts sharing one address has no
	 * safe answer. UNIQUE on a nullable column permits many NULLs, so "optional"
	 * survives. It does NOT fold case, so `setEmail` lowercases before writing;
	 * without that, Ada@x.com and ada@x.com would both pass this constraint.
	 */
	email: text('email').unique(),
	/**
	 * What you sign in with. Deliberately separate from `displayName` (PRD §9,
	 * decision 20): two friends may both be "Alex" to the group, and either may
	 * change what the group calls them without changing how they log in.
	 */
	username: text('username').notNull().unique(),
	/**
	 * scrypt, in the format `scrypt$<salt>$<key>`. NOT NULL because every account
	 * in this design has a password — when v2 adds OIDC, provider-backed accounts
	 * will need this relaxed, inside a migration already doing more.
	 */
	passwordHash: text('password_hash').notNull(),
	loginTokenHash: text('login_token_hash').notNull().unique(),
	/** PRD §11: the first account created by the setup screen. */
	isAdmin: integer('is_admin', { mode: 'boolean' }).notNull().default(false),
	createdAt: createdAt()
});

/** Empty until OIDC lands in v2 (PRD §9). Created now so that is an insert, not a migration. */
/**
 * Short-lived, single-use password-reset tokens (PRD §9). Only the SHA-256 hash
 * is stored, exactly as for sessions and login links: a leaked database must not
 * yield a working credential. `usedAt` rather than a delete, so a second click
 * on a link that is sitting in a mailbox forever is refused rather than silently
 * behaving like a fresh one.
 *
 * `timestamp`, not `timestamp_ms`: every other datetime column in this schema is
 * seconds, and one exception is how a later reader ends up comparing a seconds
 * column against a millisecond one. Truncation moves an expiry down by at most
 * 999ms, which is nothing against an hour.
 */
export const passwordResets = sqliteTable('password_resets', {
	id: uuid(),
	tokenHash: text('token_hash').notNull().unique(),
	userId: text('user_id')
		.notNull()
		.references(() => users.id, { onDelete: 'cascade' }),
	expiresAt: integer('expires_at', { mode: 'timestamp' }).notNull(),
	usedAt: integer('used_at', { mode: 'timestamp' }),
	createdAt: createdAt()
});

export const identities = sqliteTable(
	'identities',
	{
		id: uuid(),
		userId: text('user_id')
			.notNull()
			.references(() => users.id, { onDelete: 'cascade' }),
		provider: text('provider').notNull(),
		subject: text('subject').notNull(),
		createdAt: createdAt()
	},
	(table) => [unique('identities_provider_subject').on(table.provider, table.subject)]
);

/** `id` is the SHA-256 of the cookie token, never the token itself (PRD §12). */
export const sessions = sqliteTable('sessions', {
	id: text('id').primaryKey(),
	userId: text('user_id')
		.notNull()
		.references(() => users.id, { onDelete: 'cascade' }),
	createdAt: createdAt(),
	expiresAt: integer('expires_at', { mode: 'timestamp' }).notNull()
});

export const groups = sqliteTable('groups', {
	id: uuid(),
	name: text('name').notNull(),
	emoji: text('emoji'),
	/**
	 * Deliberately left `no action` (no `onDelete`): deleting a group's owner
	 * needs an ownership-transfer decision — who becomes the new owner, or
	 * whether the group is deleted too — that is not this branch's to make.
	 */
	ownerId: text('owner_id')
		.notNull()
		.references(() => users.id),
	settings: text('settings', { mode: 'json' })
		.$type<GroupSettings>()
		.notNull()
		.$defaultFn(() => DEFAULT_GROUP_SETTINGS),
	createdAt: createdAt()
});

export const memberships = sqliteTable(
	'memberships',
	{
		id: uuid(),
		userId: text('user_id')
			.notNull()
			.references(() => users.id, { onDelete: 'cascade' }),
		groupId: text('group_id')
			.notNull()
			.references(() => groups.id, { onDelete: 'cascade' }),
		role: text('role', { enum: ['owner', 'member'] })
			.notNull()
			.default('member'),
		joinedAt: integer('joined_at', { mode: 'timestamp' })
			.notNull()
			.$defaultFn(() => new Date()),
		/** Set on leaving. History stays, access does not (PRD §4). */
		leftAt: integer('left_at', { mode: 'timestamp' })
	},
	(table) => [unique('memberships_user_group').on(table.userId, table.groupId)]
);

export const invites = sqliteTable('invites', {
	/** SHA-256 of the invite token — see Stack decisions, deviation 4. */
	tokenHash: text('token_hash').primaryKey(),
	groupId: text('group_id')
		.notNull()
		.references(() => groups.id, { onDelete: 'cascade' }),
	createdBy: text('created_by').references(() => users.id, { onDelete: 'set null' }),
	expiresAt: integer('expires_at', { mode: 'timestamp' }).notNull(),
	maxUses: integer('max_uses'),
	uses: integer('uses').notNull().default(0),
	createdAt: createdAt()
});

/** Global across groups: one row per film, saving TMDB calls (PRD §10). */
export const movies = sqliteTable('movies', {
	id: uuid(),
	tmdbId: integer('tmdb_id').unique(),
	title: text('title').notNull(),
	year: integer('year'),
	posterUrl: text('poster_url'),
	runtime: integer('runtime'),
	genres: text('genres', { mode: 'json' }).$type<string[]>(),
	tmdbRating: real('tmdb_rating'),
	cachedAt: integer('cached_at', { mode: 'timestamp' })
});

export const suggestions = sqliteTable(
	'suggestions',
	{
		id: uuid(),
		groupId: text('group_id')
			.notNull()
			.references(() => groups.id, { onDelete: 'cascade' }),
		movieId: text('movie_id')
			.notNull()
			.references(() => movies.id),
		/**
		 * NULL means WILDCARD and nothing else (PRD §6): a film belonging to nobody,
		 * counting toward no member's fairness window. A departed member's films are
		 * reassigned to the "former member" placeholder (PRD §4, §12), which is a real
		 * row, so the two states stay distinguishable.
		 *
		 * `restrict`, deliberately not `set null`: a delete that reached here would
		 * silently turn somebody's suggestions into wildcards and drop them out of
		 * fairness counting. Whoever builds account deletion must call
		 * reassignToFormerMember first and should hit a loud constraint error if they
		 * forget, rather than shipping quiet data corruption.
		 */
		suggestedBy: text('suggested_by').references(() => users.id, { onDelete: 'restrict' }),
		dedupeKey: text('dedupe_key').notNull(),
		note: text('note'),
		status: text('status', { enum: ['open', 'drawn', 'withdrawn'] })
			.notNull()
			.default('open'),
		createdAt: createdAt()
	},
	(table) => [unique('suggestions_group_dedupe').on(table.groupId, table.dedupeKey)]
);

export const movieNights = sqliteTable('movie_nights', {
	id: uuid(),
	groupId: text('group_id')
		.notNull()
		.references(() => groups.id, { onDelete: 'cascade' }),
	scheduledAt: integer('scheduled_at', { mode: 'timestamp' }).notNull(),
	location: text('location'),
	suggestionId: text('suggestion_id').references(() => suggestions.id),
	drawnAt: integer('drawn_at', { mode: 'timestamp' }),
	drawSeed: text('draw_seed'),
	/** Append-only: a re-draw adds an entry, it never overwrites one (PRD §6). */
	drawLog: text('draw_log', { mode: 'json' }).$type<unknown[]>(),
	/**
	 * When the scores were revealed (PRD §7): by the last "I'm in" member's
	 * rating or by the owner. Set once, never cleared — a reveal cannot
	 * un-happen. A closed rating window also counts as revealed, derived on read.
	 */
	revealedAt: integer('revealed_at', { mode: 'timestamp' }),
	status: text('status', { enum: ['scheduled', 'drawn', 'watched', 'cancelled'] })
		.notNull()
		.default('scheduled'),
	createdAt: createdAt()
});

export const attendance = sqliteTable(
	'attendance',
	{
		id: uuid(),
		movieNightId: text('movie_night_id')
			.notNull()
			.references(() => movieNights.id, { onDelete: 'cascade' }),
		userId: text('user_id')
			.notNull()
			.references(() => users.id, { onDelete: 'cascade' }),
		response: text('response', { enum: ['yes', 'no', 'maybe'] }).notNull()
	},
	(table) => [unique('attendance_night_user').on(table.movieNightId, table.userId)]
);

/**
 * Hangs off the night, not the movie, so the same film can be rated again in
 * two years.
 *
 * No unique index on (movie_night_id, user_id): the former-member placeholder
 * (PRD §4, §12) is one row shared by every departed rater, so a second
 * departure reassigning that night's rating would collide with the first's
 * under such an index (R2). One rating per member is enforced in code
 * instead, by `saveRating` (src/lib/server/ratings.ts), which selects the
 * viewer's existing row inside its transaction and updates it rather than
 * inserting a second one.
 */
export const ratings = sqliteTable('ratings', {
	id: uuid(),
	movieNightId: text('movie_night_id')
		.notNull()
		.references(() => movieNights.id, { onDelete: 'cascade' }),
	/**
	 * `restrict`, like suggestions.suggested_by: a departed member's ratings
	 * belong to the "former member" placeholder (PRD §4, §12). Deleting an
	 * account without reassignToFormerMember first must fail loudly.
	 */
	userId: text('user_id').references(() => users.id, { onDelete: 'restrict' }),
	/** 2–20: the 1–10 half-step score doubled. Never a float (PRD §7). */
	scoreX2: integer('score_x2').notNull(),
	comment: text('comment'),
	createdAt: createdAt()
});

/** Instance-level configuration the admin edits in the UI, timezone first (PRD §10). */
export const settings = sqliteTable('settings', {
	key: text('key').primaryKey(),
	value: text('value').notNull()
});
