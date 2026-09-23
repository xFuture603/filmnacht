import { building } from '$app/environment';
import { env } from '$env/dynamic/private';
import { backupAndMigrate, createDb } from './client';

// A production build's SSR bundling step imports this module just to trace
// types, with no server actually running — so at build time it must never
// touch the real file. Without this, `npm run build` in a deployment
// directory applies pending migrations to the operator's live database, and
// if the app is still running the pre-migration WAL checkpoint comes back
// busy and the *build* fails with "Refusing to migrate".
const file = building ? ':memory:' : env.DATABASE_PATH || 'data/filmnacht.db';

export const { sqlite, db } = createDb(file);

const backup = backupAndMigrate(sqlite, db, file);
if (backup) console.log(`[filmnacht] database backed up to ${backup} before migrating`);

export type { DB } from './client';
