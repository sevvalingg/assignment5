// Şevval Boyraz, 2200004208
// Tests for the bonuses I claim. The required tests are in auth_test.ts and tasks_test.ts.
import { assert, assertEquals, assertThrows } from "@std/assert";
import { count, sql } from "drizzle-orm";
import { bearer, freshSetup, json, makeTask, PASSWORD, userToken } from "./helpers.ts";
import { tasks, users } from "../src/schema.ts";
import { purgeOldDone } from "../src/jobs.ts";
import { loadConfig } from "../src/config.ts";
import { createLoginLimiter } from "../src/ratelimit.ts";

// ---------------------------------------------------------------- Bonus 2

Deno.test("Bonus 2: a deleted task is not listed, and restore brings it back", async () => {
  const { app } = await freshSetup();
  const token = await userToken(app, "a@example.com");
  const task = await makeTask(app, token, { title: "Oops" });

  await app.request(`/api/tasks/${task.id}`, bearer(token, "DELETE"));
  const list = await (await app.request("/api/tasks", bearer(token))).json();
  assertEquals(list.total, 0);

  const restored = await app.request(
    `/api/tasks/${task.id}/restore`,
    bearer(token, "POST"),
  );
  assertEquals(restored.status, 200);
  assertEquals((await restored.json()).deletedAt, null);
  assertEquals((await (await app.request("/api/tasks", bearer(token))).json()).total, 1);

  // restoring a task that is not deleted is 404
  const again = await app.request(`/api/tasks/${task.id}/restore`, bearer(token, "POST"));
  assertEquals(again.status, 404);
});

Deno.test("Bonus 2: another user cannot restore my deleted task", async () => {
  const { app } = await freshSetup();
  const a = await userToken(app, "a@example.com");
  const b = await userToken(app, "b@example.com");
  const task = await makeTask(app, a, { title: "Mine" });
  await app.request(`/api/tasks/${task.id}`, bearer(a, "DELETE"));
  const res = await app.request(`/api/tasks/${task.id}/restore`, bearer(b, "POST"));
  assertEquals(res.status, 404);
});

Deno.test("Bonus 2: register creates the user and the welcome task together", async () => {
  const { app } = await freshSetup({ welcomeTask: "Welcome!" });
  const token = await userToken(app, "a@example.com");
  const list = await (await app.request("/api/tasks", bearer(token))).json();
  assertEquals(list.items.map((t: { title: string }) => t.title), ["Welcome!"]);
});

Deno.test("Bonus 2: when the welcome task fails, no user is left behind", async () => {
  const { app, db } = await freshSetup({ welcomeTask: "Welcome!" });
  await db.client.execute("DROP TABLE tasks"); // the second insert must now throw

  const original = console.error;
  console.error = () => {}; // onError logs the expected failure; keep the output clean
  try {
    const res = await app.request(
      "/auth/register",
      json({ email: "a@example.com", password: PASSWORD }),
    );
    assertEquals(res.status, 500);
    assertEquals((await res.json()).error, "internal error");
  } finally {
    console.error = original;
  }
  const [{ n }] = await db.db.select({ n: count() }).from(users);
  assertEquals(n, 0);
});

// ---------------------------------------------------------------- Bonus 3

Deno.test("Bonus 3: the summary counts my tasks per status, deleted ones left out", async () => {
  const { app } = await freshSetup();
  const a = await userToken(app, "a@example.com");
  const b = await userToken(app, "b@example.com");
  await makeTask(app, a, { title: "1" });
  await makeTask(app, a, { title: "2", status: "done" });
  await makeTask(app, a, { title: "3", status: "done" });
  const gone = await makeTask(app, a, { title: "4", status: "in-progress" });
  await app.request(`/api/tasks/${gone.id}`, bearer(a, "DELETE"));
  await makeTask(app, b, { title: "not mine" });

  const res = await app.request("/api/me/summary", bearer(a));
  assertEquals(await res.json(), { "todo": 1, "in-progress": 0, "done": 2, total: 3 });
});

// ---------------------------------------------------------------- Bonus 9

Deno.test("Bonus 9: admin route: no token 401, a normal user 403, an admin 200", async () => {
  const { app } = await freshSetup({ adminEmail: "boss@example.com" });
  const user = await userToken(app, "a@example.com");
  const admin = await userToken(app, "boss@example.com");

  assertEquals((await app.request("/api/admin/users")).status, 401);
  const forbidden = await app.request("/api/admin/users", bearer(user));
  assertEquals(forbidden.status, 403);
  assertEquals((await forbidden.json()).error, "forbidden");

  const ok = await app.request("/api/admin/users", bearer(admin));
  assertEquals(ok.status, 200);
  const { items } = await ok.json();
  assertEquals(items.map((u: { role: string }) => u.role), ["user", "admin"]);
  assertEquals(JSON.stringify(items).includes("password"), false);
});

// ---------------------------------------------------------------- Bonus 10

Deno.test("Bonus 10: x-request-id on every response, also in a 404 body", async () => {
  const { app } = await freshSetup();
  const ok = await app.request("/health");
  assert(ok.headers.get("x-request-id"));

  const missing = await app.request("/nope");
  const id = missing.headers.get("x-request-id");
  assertEquals((await missing.json()).requestId, id);
});

Deno.test("Bonus 10: one JSON log line per request, with no password or token", async () => {
  const lines: string[] = [];
  const { app } = await freshSetup({ log: (l) => lines.push(l) });
  const token = await userToken(app, "a@example.com"); // register + login: 2 lines
  await app.request("/api/tasks", bearer(token)); // 1 line

  assertEquals(lines.length, 3);
  const last = JSON.parse(lines[2]);
  assertEquals([last.method, last.path, last.status], ["GET", "/api/tasks", 200]);
  assertEquals(typeof last.ms, "number");
  const all = lines.join("\n");
  assertEquals(all.includes(PASSWORD), false);
  assertEquals(all.includes(token), false);
});

// ---------------------------------------------------------------- Bonus 11

Deno.test("Bonus 11: /healthz is 200, /readyz is 200 and then 503 without a database", async () => {
  const { app, db } = await freshSetup();
  assertEquals((await app.request("/healthz")).status, 200);
  const ready = await app.request("/readyz");
  assertEquals([ready.status, await ready.json()], [200, { ready: true }]);

  db.client.close(); // the database is gone
  const down = await app.request("/readyz");
  assertEquals([down.status, await down.json()], [503, { ready: false }]);
});

Deno.test("Bonus 11: configuration is checked and bad values are refused", () => {
  const ok = loadConfig({ PORT: "9000", APP_ENV: "test" });
  assertEquals([ok.PORT, ok.DATABASE_URL, ok.APP_ENV], [9000, "file:./tasks.db", "test"]);

  assertThrows(() => loadConfig({ PORT: "abc" }));
  assertThrows(() => loadConfig({ APP_ENV: "staging" }));
  assertThrows(() => loadConfig({ DATABASE_URL: "tasks.db" }));
  // production with the default secret is refused, with a real one it is fine
  assertThrows(() => loadConfig({ APP_ENV: "production" }));
  assertEquals(
    loadConfig({ APP_ENV: "production", JWT_SECRET: "a-long-real-secret" }).APP_ENV,
    "production",
  );
});

// ---------------------------------------------------------------- Bonus 14

Deno.test("Bonus 14: purgeOldDone removes only old done tasks, and twice is harmless", async () => {
  const { db } = await freshSetup();
  const [u] = await db.db.insert(users).values({ email: "a@x.io", passwordHash: "x" })
    .returning();
  const daysAgo = (d: number) => sql`strftime('%s','now') - ${d * 86_400}`;
  await db.db.insert(tasks).values([
    { userId: u.id, title: "old done", status: "done", completedAt: daysAgo(31) },
    { userId: u.id, title: "new done", status: "done", completedAt: daysAgo(2) },
    { userId: u.id, title: "old todo", status: "todo" },
  ]);

  assertEquals(await purgeOldDone(db, 30), 1);
  assertEquals(await purgeOldDone(db, 30), 0); // idempotent
  const left = await db.db.select({ title: tasks.title }).from(tasks);
  assertEquals(left.map((t) => t.title), ["new done", "old todo"]);
});

// ---------------------------------------------------------------- Bonus 15

Deno.test("Bonus 15: after 5 failed logins the 6th is 429, even with the right password", async () => {
  const { app } = await freshSetup();
  await userToken(app, "a@example.com");
  const wrong = json({ email: "a@example.com", password: "wrong-password" });
  for (let i = 0; i < 5; i++) {
    assertEquals((await app.request("/auth/login", wrong)).status, 401);
  }
  const blocked = await app.request(
    "/auth/login",
    json({ email: "a@example.com", password: PASSWORD }),
  );
  assertEquals(blocked.status, 429);
  const retry = Number(blocked.headers.get("retry-after"));
  assert(retry > 0 && retry <= 60, `Retry-After was ${retry}`);

  // another email is not blocked
  await userToken(app, "b@example.com");
});

Deno.test("Bonus 15: the window ends and a success clears the counter", () => {
  let now = 0;
  const limiter = createLoginLimiter({ max: 2, windowMs: 1000 }, () => now);
  limiter.recordFailure("k");
  limiter.recordFailure("k");
  assertEquals(limiter.retryAfterSeconds("k"), 1);
  now = 1000; // the window is over
  assertEquals(limiter.retryAfterSeconds("k"), 0);

  limiter.recordFailure("k");
  limiter.reset("k");
  limiter.recordFailure("k");
  assertEquals(limiter.retryAfterSeconds("k"), 0); // only 1 failure since the reset
});

// ---------------------------------------------------------------- Bonus 16

/** Count the SELECTs on the tasks table that Drizzle sends. */
function taskReadCounter() {
  const counter = {
    reads: 0,
    logQuery(query: string) {
      if (/^select .* from "tasks"/i.test(query)) counter.reads++;
    },
  };
  return counter;
}

Deno.test("Bonus 16: the second read is a cache hit (no database query)", async () => {
  const kv = await Deno.openKv(":memory:");
  try {
    const counter = taskReadCounter();
    const { app } = await freshSetup({ kv }, counter);
    const token = await userToken(app, "a@example.com");
    const task = await makeTask(app, token, { title: "Cached" });

    counter.reads = 0;
    await app.request(`/api/tasks/${task.id}`, bearer(token));
    await app.request(`/api/tasks/${task.id}`, bearer(token));
    assertEquals(counter.reads, 1);
  } finally {
    kv.close();
  }
});

Deno.test("Bonus 16: after an update or delete the cache does not serve stale data", async () => {
  const kv = await Deno.openKv(":memory:");
  try {
    const { app } = await freshSetup({ kv });
    const token = await userToken(app, "a@example.com");
    const task = await makeTask(app, token, { title: "Before" });
    const url = `/api/tasks/${task.id}`;

    await app.request(url, bearer(token)); // now cached
    await app.request(url, json({ title: "After" }, token, "PUT"));
    assertEquals((await (await app.request(url, bearer(token))).json()).title, "After");

    await app.request(url, bearer(token, "DELETE"));
    assertEquals((await app.request(url, bearer(token))).status, 404);
  } finally {
    kv.close();
  }
});

Deno.test("Bonus 16: the cache key includes the user", async () => {
  const kv = await Deno.openKv(":memory:");
  try {
    const { app } = await freshSetup({ kv });
    const a = await userToken(app, "a@example.com");
    const b = await userToken(app, "b@example.com");
    const task = await makeTask(app, a, { title: "A's" });

    await app.request(`/api/tasks/${task.id}`, bearer(a)); // cached for A
    const entry = await kv.get(["task", 1, task.id]);
    assertEquals((entry.value as { title: string }).title, "A's");
    assertEquals((await app.request(`/api/tasks/${task.id}`, bearer(b))).status, 404);
  } finally {
    kv.close();
  }
});
