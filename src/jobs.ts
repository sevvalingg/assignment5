// Şevval Boyraz, 2200004208
// Bonus 14: the background job, written as a plain function so a test can call it.
import { and, eq, lt, sql } from "drizzle-orm";
import type { Db } from "./db.ts";
import { tasks } from "./schema.ts";

/**
 * Delete (for real) every task that has been "done" for more than `days` days.
 * Idempotent: a second run finds nothing left to delete. Returns how many rows went.
 */
export async function purgeOldDone({ db }: Db, days: number): Promise<number> {
  const removed = await db.delete(tasks)
    .where(and(
      eq(tasks.status, "done"),
      lt(tasks.completedAt, sql`strftime('%s','now') - ${days * 86_400}`),
    ))
    .returning({ id: tasks.id });
  return removed.length;
}
