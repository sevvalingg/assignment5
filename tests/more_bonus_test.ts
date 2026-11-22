// Şevval Boyraz, 2200004208
// Tests for Bonus 1, 6, 7, 8, 12 and 13.
import { assert, assertEquals, assertRejects } from "@std/assert";
import { createApp } from "../src/app.ts";
import { signToken } from "../src/auth.ts";
import { createDb, migrate } from "../src/db.ts";
import { createDbPool, Pool } from "../src/pool.ts";
import { bearer, freshSetup, json, makeTask, userToken } from "./helpers.ts";

// ---------------------------------------------------------------- Bonus 1

Deno.test("Bonus 1: the two migrations run once, and a second migrate() is harmless", async () => {
  const { db } = await freshSetup(); // migrate() ran once already
  await migrate(db); // and again: nothing to do, no error
  const done = await db.client.execute("SELECT hash FROM __drizzle_migrations");
  assertEquals(done.rows.length, 2); // 0000_init and 0001_add_attachment
  const cols = await db.client.execute("PRAGMA table_info(tasks)");
  assert(cols.rows.some((r) => r.name === "attachment"));
});

Deno.test("Bonus 1: the database itself refuses a wrong status (CHECK)", async () => {
  const { db } = await freshSetup();
  await db.client.execute(
    "INSERT INTO users (email, password_hash) VALUES ('a@x.io', 'x')",
  );
  await assertRejects(() =>
    db.client.execute(
      "INSERT INTO tasks (user_id, title, status) VALUES (1, 't', 'finished')",
    )
  );
});

// ---------------------------------------------------------------- Bonus 6

Deno.test("Bonus 6: 20 jobs on a pool of 3 never run more than 3 at once", async () => {
  const pool = new Pool(["a", "b", "c"]);
  let running = 0;
  let highest = 0;
  const jobs = Array.from({ length: 20 }, (_, i) =>
    pool.use(async () => {
      running++;
      highest = Math.max(highest, running);
      await new Promise((r) => setTimeout(r, 5));
      running--;
      return i;
    }));
  const results = await Promise.all(jobs);
  assertEquals(highest, 3);
  assertEquals(results.length, 20);
  assertEquals(pool.waiting, 0);
});

Deno.test("Bonus 6: a job that throws still gives its connection back", async () => {
  const pool = new Pool([1]);
  await assertRejects(() => pool.use(() => Promise.reject(new Error("boom"))));
  // if the item had not been released, this would wait forever
  assertEquals(await pool.use((item) => Promise.resolve(item)), 1);
});

Deno.test("Bonus 6: the app works through a pool, also with many requests at once", async () => {
  const file = await Deno.makeTempFile({ suffix: ".db" });
  const main = createDb(`file:${file}`);
  await migrate(main);
  const pool = await createDbPool(`file:${file}`, 3);
  const app = createApp(main, { pool, log: () => {} });
  const token = await userToken(app, "a@example.com");

  const created = await Promise.all(
    Array.from(
      { length: 10 },
      (_, i) => app.request("/api/tasks", json({ title: `t${i}` }, token)),
    ),
  );
  assertEquals(created.map((r) => r.status), Array(10).fill(201));
  const page = await (await app.request("/api/tasks", bearer(token))).json();
  assertEquals(page.total, 10);
});

// ---------------------------------------------------------------- Bonus 7

Deno.test("Bonus 7: login gives a JWT with three parts", async () => {
  const { app } = await freshSetup();
  const token = await userToken(app, "a@example.com");
  assertEquals(token.split(".").length, 3);
  assertEquals((await app.request("/api/tasks", bearer(token))).status, 200);
});

Deno.test("Bonus 7: a tampered token is 401", async () => {
  const { app } = await freshSetup();
  const token = await userToken(app, "a@example.com");
  // change one character of the signature
  const last = token.at(-1) === "A" ? "B" : "A";
  const tampered = token.slice(0, -1) + last;
  assertEquals((await app.request("/api/tasks", bearer(tampered))).status, 401);
});

Deno.test("Bonus 7: an expired token is 401", async () => {
  const { app } = await freshSetup();
  await userToken(app, "a@example.com");
  const past = Math.floor(Date.now() / 1000) - 60; // expired a minute ago
  const expired = await signToken("dev-secret", { userId: 1, role: "user" }, past);
  assertEquals((await app.request("/api/tasks", bearer(expired))).status, 401);
});

Deno.test("Bonus 7: a token signed with another secret is 401", async () => {
  const { app } = await freshSetup({ jwtSecret: "the-real-secret" });
  await userToken(app, "a@example.com");
  const forged = await signToken("dev-secret", { userId: 1, role: "admin" });
  assertEquals((await app.request("/api/tasks", bearer(forged))).status, 401);
  assertEquals((await app.request("/api/admin/users", bearer(forged))).status, 401);
});

Deno.test("Bonus 7: the session tokens of R3 still work with auth: 'session'", async () => {
  const { app } = await freshSetup({ auth: "session" });
  const token = await userToken(app, "a@example.com");
  assertEquals(token.split(".").length, 1); // a random UUID, not a JWT
  assertEquals((await app.request("/api/tasks", bearer(token))).status, 200);
});

// ---------------------------------------------------------------- Bonus 8

Deno.test("Bonus 8: /openapi.json lists every route, with its failures and Bearer", async () => {
  const { app } = await freshSetup();
  const doc = await (await app.request("/openapi.json")).json();
  assertEquals(doc.openapi, "3.1.0");

  const expected: Record<string, string[]> = {
    "/health": ["get"],
    "/auth/register": ["post"],
    "/auth/login": ["post"],
    "/api/tasks": ["get", "post"],
    "/api/tasks/{id}": ["get", "put", "delete"],
    "/api/tasks/{id}/restore": ["post"],
    "/api/tasks/{id}/attachment": ["get", "post"],
    "/api/me/summary": ["get"],
    "/api/admin/users": ["get"],
  };
  for (const [path, methods] of Object.entries(expected)) {
    assertEquals(Object.keys(doc.paths[path]).sort(), methods.sort(), path);
    if (path.startsWith("/api")) {
      for (const m of methods) {
        assert(doc.paths[path][m].responses["401"], `${m} ${path} has no 401`);
        assertEquals(doc.paths[path][m].security, [{ Bearer: [] }]);
      }
    }
  }
  assertEquals(doc.components.securitySchemes.Bearer.scheme, "bearer");
  assert(doc.paths["/auth/register"].post.responses["409"]);
  assert(doc.paths["/api/tasks/{id}"].get.responses["404"]);
});

Deno.test("Bonus 8: /docs is an HTML page that loads /openapi.json", async () => {
  const { app } = await freshSetup();
  const res = await app.request("/docs");
  assertEquals(res.status, 200);
  const html = await res.text();
  assert(html.includes("swagger"));
  assert(html.includes("/openapi.json"));
});

// ---------------------------------------------------------------- Bonus 12

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);

async function upload(
  app: ReturnType<typeof createApp>,
  token: string,
  id: number,
  file?: File,
) {
  const form = new FormData();
  if (file) form.append("file", file);
  return await app.request(`/api/tasks/${id}/attachment`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}` },
    body: form,
  });
}

Deno.test("Bonus 12: upload a PNG, then download the same bytes as image/png", async () => {
  const uploadDir = await Deno.makeTempDir();
  const { app } = await freshSetup({ uploadDir });
  const token = await userToken(app, "a@example.com");
  const task = await makeTask(app, token, { title: "With picture" });

  const res = await upload(
    app,
    token,
    task.id,
    new File([PNG], "../../evil.png", {
      type: "image/png",
    }),
  );
  assertEquals(res.status, 201);
  const updated = await res.json();
  assert(/^[0-9a-f-]{36}\.png$/.test(updated.attachment)); // our name, not the user's

  const down = await app.request(`/api/tasks/${task.id}/attachment`, bearer(token));
  assertEquals(down.status, 200);
  assertEquals(down.headers.get("content-type"), "image/png");
  assertEquals(new Uint8Array(await down.arrayBuffer()), PNG);
});

Deno.test("Bonus 12: no file 400, over 1 MB 413, not an image 415", async () => {
  const uploadDir = await Deno.makeTempDir();
  const { app } = await freshSetup({ uploadDir });
  const token = await userToken(app, "a@example.com");
  const task = await makeTask(app, token, { title: "x" });

  assertEquals((await upload(app, token, task.id)).status, 400);

  const big = new Uint8Array(1_000_001);
  big.set(PNG);
  const tooBig = await upload(
    app,
    token,
    task.id,
    new File([big], "a.png", { type: "image/png" }),
  );
  assertEquals(tooBig.status, 413);

  const text = new File(["hello"], "a.txt", { type: "text/plain" });
  assertEquals((await upload(app, token, task.id, text)).status, 415);

  // a text file that only CLAIMS to be a PNG
  const fake = new File(["hello"], "a.png", { type: "image/png" });
  assertEquals((await upload(app, token, task.id, fake)).status, 415);
});

Deno.test("Bonus 12: another user cannot upload to or download my attachment", async () => {
  const uploadDir = await Deno.makeTempDir();
  const { app } = await freshSetup({ uploadDir });
  const a = await userToken(app, "a@example.com");
  const b = await userToken(app, "b@example.com");
  const task = await makeTask(app, a, { title: "A's" });
  await upload(app, a, task.id, new File([PNG], "a.png", { type: "image/png" }));

  const png = new File([PNG], "b.png", { type: "image/png" });
  assertEquals((await upload(app, b, task.id, png)).status, 404);
  assertEquals(
    (await app.request(`/api/tasks/${task.id}/attachment`, bearer(b))).status,
    404,
  );
});

// ---------------------------------------------------------------- Bonus 13

Deno.test("Bonus 13: /ws with a bad or missing token is 401", async () => {
  const { app } = await freshSetup();
  assertEquals((await app.request("/ws")).status, 401);
  assertEquals((await app.request("/ws?token=nonsense")).status, 401);
});

Deno.test("Bonus 13: a change reaches the owner's socket, and only theirs", async () => {
  const { app } = await freshSetup();
  const a = await userToken(app, "a@example.com");
  const b = await userToken(app, "b@example.com");

  const server = Deno.serve({ port: 0, onListen: () => {} }, app.fetch);
  const base = `localhost:${server.addr.port}`;

  /** Open a socket and collect what it receives. */
  async function listen(token: string) {
    const ws = new WebSocket(`ws://${base}/ws?token=${token}`);
    const received: { type: string; task: { title: string } }[] = [];
    ws.onmessage = (e) => received.push(JSON.parse(e.data));
    await new Promise((resolve) => (ws.onopen = resolve));
    return { ws, received };
  }

  const sa = await listen(a);
  const sb = await listen(b);
  await new Promise((r) => setTimeout(r, 50)); // let the server register both

  const created = await fetch(`http://${base}/api/tasks`, json({ title: "Live!" }, a));
  assertEquals(created.status, 201);
  await created.body?.cancel();
  await new Promise((r) => setTimeout(r, 100));

  assertEquals(sa.received.map((m) => [m.type, m.task.title]), [["created", "Live!"]]);
  assertEquals(sb.received, []); // B never hears about A's task

  for (const { ws } of [sa, sb]) {
    const closed = new Promise((r) => (ws.onclose = r));
    ws.close();
    await closed;
  }
  await server.shutdown();
});
