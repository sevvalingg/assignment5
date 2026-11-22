// Şevval Boyraz, 2200004208
// Bonus 3: the N+1 problem, made visible by counting the queries Drizzle sends.
//   deno task nplus1
import { and, count, eq } from "drizzle-orm";
import { createDb, migrate } from "../src/db.ts";
import { STATUSES, tasks, users } from "../src/schema.ts";

const sent: string[] = [];
const logger = { logQuery: (query: string) => sent.push(query) };

const file = await Deno.makeTempFile({ suffix: ".db" });
const db = createDb(`file:${file}`, logger);
await migrate(db);

const [user] = await db.db.insert(users)
  .values({ email: "a@example.com", passwordHash: "x" }).returning();
await db.db.insert(tasks).values(
  Array.from({ length: 30 }, (_, i) => ({
    userId: user.id,
    title: `Task ${i}`,
    status: STATUSES[i % 3],
  })),
);

/** Naive: load the tasks, then for every task ask how many tasks share its status. */
async function naive(userId: number) {
  const mine = await db.db.select().from(tasks).where(eq(tasks.userId, userId));
  const summary: Record<string, number> = {};
  for (const t of mine) {
    const [{ n }] = await db.db.select({ n: count() }).from(tasks)
      .where(and(eq(tasks.userId, userId), eq(tasks.status, t.status)));
    summary[t.status] = n;
  }
  return summary;
}

/** Good: one GROUP BY query, whatever the number of tasks. */
async function grouped(userId: number) {
  const rows = await db.db.select({ status: tasks.status, n: count() }).from(tasks)
    .where(eq(tasks.userId, userId)).groupBy(tasks.status);
  return Object.fromEntries(rows.map((r) => [r.status, r.n]));
}

for (const [name, fn] of [["naive", naive], ["grouped", grouped]] as const) {
  sent.length = 0;
  const result = await fn(user.id);
  console.log(`${name}: ${sent.length} queries -> ${JSON.stringify(result)}`);
  console.log(`  first: ${sent[0]}`);
  if (sent.length > 1) console.log(`  then ${sent.length - 1} times: ${sent[1]}`);
}

db.client.close();
try {
  await Deno.remove(file);
} catch {
  // On Windows the file can still be locked right after close() (os error 32).
  // It is only a temporary file, so leaving it in the temp folder is harmless.
}
