import { env } from '$env/dynamic/private';
import { backupAndMigrate, createDb } from './client';

const file = env.DATABASE_PATH || 'data/filmnacht.db';

export const { sqlite, db } = createDb(file);

const backup = backupAndMigrate(sqlite, db, file);
if (backup) console.log(`[filmnacht] database backed up to ${backup} before migrating`);

export type { DB } from './client';
