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
	repeatDrawnFilms: boolean;
};

export const DEFAULT_GROUP_SETTINGS: GroupSettings = {
	maxOpenSuggestions: 3,
	drawMode: 'fairness',
	resultVisible: 'immediately',
	nightEndsAfterMinutes: 180,
	ratingWindowDays: 7,
	repeatDrawnFilms: false
};

export const users = sqliteTable('users', {
	id: uuid(),
	displayName: text('display_name').notNull(),
	avatarUrl: text('avatar_url'),
	/** Unused in the MVP (PRD §9). Nullable until SMTP arrives in v1.0. */
	email: text('email'),
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
		/** Null for the v1.0 wildcard pick, which belongs to nobody (PRD §10). */
		suggestedBy: text('suggested_by').references(() => users.id, { onDelete: 'set null' }),
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

/** Hangs off the night, not the movie, so the same film can be rated again in two years. */
export const ratings = sqliteTable(
	'ratings',
	{
		id: uuid(),
		movieNightId: text('movie_night_id')
			.notNull()
			.references(() => movieNights.id, { onDelete: 'cascade' }),
		userId: text('user_id').references(() => users.id, { onDelete: 'set null' }),
		/** 2–20: the 1–10 half-step score doubled. Never a float (PRD §7). */
		scoreX2: integer('score_x2').notNull(),
		comment: text('comment'),
		createdAt: createdAt()
	},
	(table) => [unique('ratings_night_user').on(table.movieNightId, table.userId)]
);

/** Instance-level configuration the admin edits in the UI, timezone first (PRD §10). */
export const settings = sqliteTable('settings', {
	key: text('key').primaryKey(),
	value: text('value').notNull()
});
