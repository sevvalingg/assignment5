// Şevval Boyraz, 2200004208
import { createApp } from "./app.ts";
import { loadConfig } from "./config.ts";
import { createDb, migrate } from "./db.ts";
import { purgeOldDone } from "./jobs.ts";
import { createDbPool } from "./pool.ts";

// Bonus 11: one validated config object instead of loose Deno.env.get calls.
let config;
try {
  config = loadConfig(Deno.env.toObject());
} catch (err) {
  console.error((err as Error).message);
  Deno.exit(1);
}

const db = createDb(config.DATABASE_URL, undefined, config.DATABASE_AUTH_TOKEN);
await migrate(db);

// Bonus 6: the task routes borrow one of these connections per request.
const pool = await createDbPool(
  config.DATABASE_URL,
  config.DB_POOL_SIZE,
  config.DATABASE_AUTH_TOKEN,
);

// Bonus 16: Deno KV as a cache. Locally in memory (a cache may start empty after a
// restart); on Deno Deploy, where ":memory:" is not offered, the platform's own KV.
const kv = await Deno.openKv(":memory:").catch(() => Deno.openKv());

// Bonus 14: every night at 03:00 remove tasks that have been done for 30 days.
// PURGE_SCHEDULE="* * * * *" runs it every minute, to see it work.
Deno.cron("purge old done tasks", config.PURGE_SCHEDULE, async () => {
  const removed = await purgeOldDone(db, 30);
  console.log(JSON.stringify({ job: "purge", at: new Date().toISOString(), removed }));
});

const app = createApp(db, {
  kv,
  pool,
  adminEmail: config.ADMIN_EMAIL,
  jwtSecret: config.JWT_SECRET,
  welcomeTask: "Welcome! Move me to done when you have read the README.",
});

Deno.serve({ port: config.PORT }, app.fetch);
