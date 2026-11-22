// Şevval Boyraz, 2200004208
// Bonus 5: fill a database with demo users and tasks. Safe to run twice.
//   deno task seed
import { count, eq, inArray } from "drizzle-orm";
import { hashPassword } from "../src/auth.ts";
import { loadConfig } from "../src/config.ts";
import { createDb, migrate } from "../src/db.ts";
import { PRIORITIES, STATUSES, tasks, users } from "../src/schema.ts";

const config = loadConfig(Deno.env.toObject());
if (config.APP_ENV === "production") {
  console.error("Refusing to seed a production database.");
  Deno.exit(1);
}

export const DEMO_PASSWORD = "demo-password";
const DEMO = [
  { email: "demo@example.com", role: "user" as const },
  { email: "admin@example.com", role: "admin" as const },
];

const db = createDb(config.DATABASE_URL);
await migrate(db);

const passwordHash = await hashPassword(DEMO_PASSWORD);
// A user that already exists is skipped, not duplicated and not overwritten.
await db.db.insert(users)
  .values(DEMO.map((u) => ({ ...u, passwordHash })))
  .onConflictDoNothing({ target: users.email });

const demoUsers = await db.db.select().from(users)
  .where(inArray(users.email, DEMO.map((u) => u.email)));

for (const user of demoUsers) {
  const [{ n }] = await db.db.select({ n: count() }).from(tasks)
    .where(eq(tasks.userId, user.id));
  if (n > 0) {
    console.log(`${user.email}: already has ${n} tasks, skipped`);
    continue;
  }
  const rows = Array.from({ length: 10 }, (_, i) => ({
    userId: user.id,
    title: `Demo task ${i + 1} for ${user.email.split("@")[0]}`,
    status: STATUSES[i % STATUSES.length],
    priority: PRIORITIES[i % PRIORITIES.length],
  }));
  await db.db.insert(tasks).values(rows);
  console.log(`${user.email}: added ${rows.length} tasks`);
}

console.log(`Log in with one of ${DEMO.map((u) => u.email).join(", ")}`);
console.log(`and the password "${DEMO_PASSWORD}".`);
db.client.close();
