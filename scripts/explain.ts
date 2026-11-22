// Şevval Boyraz, 2200004208
// Bonus 4: show what the index changes, with the query plan and a timing.
//   deno task explain
// Works on a temporary database, so your tasks.db is not touched.
import { createDb, migrate } from "../src/db.ts";
import { tasks, users } from "../src/schema.ts";
import { STATUSES } from "../src/schema.ts";

const file = await Deno.makeTempFile({ suffix: ".db" });
const db = createDb(`file:${file}`);
await migrate(db);

// migrate() creates the index; drop it first to see the "before" plan.
await db.client.execute("DROP INDEX IF EXISTS idx_tasks_user_status");

// 20 users with 1,000 tasks each = 20,000 tasks, in batches of 500.
const userRows = Array.from({ length: 20 }, (_, i) => ({
  email: `user${i + 1}@example.com`,
  passwordHash: "not-a-real-hash",
}));
const created = await db.db.insert(users).values(userRows).returning({ id: users.id });
for (const { id } of created) {
  for (let start = 0; start < 1000; start += 500) {
    const batch = Array.from({ length: 500 }, (_, i) => ({
      userId: id,
      title: `Task ${start + i}`,
      status: STATUSES[(start + i) % 3],
    }));
    await db.db.insert(tasks).values(batch);
  }
}

const QUERY = "SELECT * FROM tasks WHERE user_id = ? AND status = ?";
const ARGS = [7, "done"];

async function plan(): Promise<string> {
  const res = await db.client.execute({ sql: `EXPLAIN QUERY PLAN ${QUERY}`, args: ARGS });
  return res.rows.map((r) => String(r.detail)).join("; ");
}

/** The median of 50 runs, so one slow run does not decide the result. */
async function time(): Promise<number> {
  const runs: number[] = [];
  for (let i = 0; i < 50; i++) {
    const t = performance.now();
    await db.client.execute({ sql: QUERY, args: ARGS });
    runs.push(performance.now() - t);
  }
  runs.sort((a, b) => a - b);
  return runs[25];
}

console.log(`20,000 tasks. Query: ${QUERY}  [${ARGS.join(", ")}]`);
console.log(`before: ${await plan()}`);
console.log(`        median ${(await time()).toFixed(3)} ms`);

await db.client.execute(
  "CREATE INDEX idx_tasks_user_status ON tasks(user_id, status)",
);
console.log(`after:  ${await plan()}`);
console.log(`        median ${(await time()).toFixed(3)} ms`);

db.client.close();
try {
  await Deno.remove(file);
} catch {
  // On Windows the file can still be locked right after close() (os error 32).
  // It is only a temporary file, so leaving it in the temp folder is harmless.
}
