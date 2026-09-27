import { eq } from 'drizzle-orm';
import type { DB } from './db/client';
import { groups, movieNights } from './db/schema';
import { groupSettings } from './group-settings';
import { drawNight } from './nights';

const HOUR = 60 * 60 * 1000;

/**
 * Scheduled nights in groups with automatic draw on whose draw time has come
 * and whose night has not started. A night missed while the server was down
 * is drawn on the next tick, but never after it starts.
 */
export function dueForAutoDraw(db: DB, now: Date): string[] {
	return db
		.select({ id: movieNights.id, scheduledAt: movieNights.scheduledAt, settings: groups.settings })
		.from(movieNights)
		.innerJoin(groups, eq(groups.id, movieNights.groupId))
		.where(eq(movieNights.status, 'scheduled'))
		.all()
		.filter((n) => {
			const s = groupSettings(n.settings);
			const at = n.scheduledAt.getTime();
			return s.autoDraw && now.getTime() >= at - s.autoDrawHoursBefore * HOUR && now.getTime() < at;
		})
		.map((n) => n.id);
}

/** One tick. Synchronous: each draw is its own test-and-set transaction. */
export function runDueDraws(
	db: DB,
	now: Date,
	onDrawn: (nightId: string) => void = () => {}
): number {
	let drawn = 0;
	for (const id of dueForAutoDraw(db, now)) {
		// No candidates yet → try again next minute; a manual draw in between wins the claim.
		if (drawNight(db, id, null).ok) {
			drawn++;
			onDrawn(id);
		}
	}
	return drawn;
}

const STARTED = Symbol.for('filmnacht.scheduler');

/** Once per process, even when the dev server reloads this module. */
export function startScheduler(db: DB, onDrawn: (nightId: string) => void): void {
	const g = globalThis as Record<symbol, unknown>;
	if (g[STARTED]) return;
	g[STARTED] = true;
	setInterval(() => {
		try {
			runDueDraws(db, new Date(), onDrawn);
		} catch (err) {
			// A tick must never take the server down; the next minute tries again.
			console.error('[filmnacht] automatic draw tick failed', err);
		}
	}, 60_000).unref?.();
}
