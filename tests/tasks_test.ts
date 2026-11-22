// Şevval Boyraz, 2200004208
import { assertEquals } from "@std/assert";
import { bearer, freshApp, json, makeTask, userToken } from "./helpers.ts";

Deno.test("create a task: 201 with the defaults filled in", async () => {
  const app = await freshApp();
  const token = await userToken(app, "a@example.com");
  const res = await app.request("/api/tasks", json({ title: "  Write tests  " }, token));
  assertEquals(res.status, 201);
  const task = await res.json();
  assertEquals(task.title, "Write tests"); // trimmed
  assertEquals(task.status, "todo");
  assertEquals(task.priority, "medium");
  assertEquals(task.dueDate, null);
  assertEquals(typeof task.createdAt, "number");
});

Deno.test("the list holds only my own tasks", async () => {
  const app = await freshApp();
  const a = await userToken(app, "a@example.com");
  const b = await userToken(app, "b@example.com");
  await makeTask(app, a, { title: "A1" });
  await makeTask(app, a, { title: "A2" });
  await makeTask(app, b, { title: "B1" });

  const res = await app.request("/api/tasks", bearer(a));
  const page = await res.json();
  assertEquals(page.total, 2);
  assertEquals(page.items.map((t: { title: string }) => t.title), ["A1", "A2"]);
});

Deno.test("get one task: 200 for the owner, 404 for an unknown or bad id", async () => {
  const app = await freshApp();
  const token = await userToken(app, "a@example.com");
  const task = await makeTask(app, token, { title: "Mine" });

  const ok = await app.request(`/api/tasks/${task.id}`, bearer(token));
  assertEquals(ok.status, 200);
  assertEquals((await ok.json()).title, "Mine");

  assertEquals((await app.request("/api/tasks/9999", bearer(token))).status, 404);
  assertEquals((await app.request("/api/tasks/abc", bearer(token))).status, 404);
});

Deno.test("user B cannot read, change or delete user A's task (404 each)", async () => {
  const app = await freshApp();
  const a = await userToken(app, "a@example.com");
  const b = await userToken(app, "b@example.com");
  const task = await makeTask(app, a, { title: "Secret" });
  const url = `/api/tasks/${task.id}`;

  const read = await app.request(url, bearer(b));
  const change = await app.request(url, json({ title: "Hacked" }, b, "PUT"));
  const remove = await app.request(url, bearer(b, "DELETE"));
  assertEquals([read.status, change.status, remove.status], [404, 404, 404]);
  assertEquals((await read.json()).error, "not found");

  // and A's task is untouched
  const still = await (await app.request(url, bearer(a))).json();
  assertEquals(still.title, "Secret");
});

Deno.test("update a task: 200 with the new values, completedAt set when done", async () => {
  const app = await freshApp();
  const token = await userToken(app, "a@example.com");
  const task = await makeTask(app, token, { title: "Old" });

  const res = await app.request(
    `/api/tasks/${task.id}`,
    json({ title: "New", status: "done", priority: "high" }, token, "PUT"),
  );
  assertEquals(res.status, 200);
  const updated = await res.json();
  assertEquals([updated.title, updated.status, updated.priority], [
    "New",
    "done",
    "high",
  ]);
  assertEquals(typeof updated.completedAt, "number");
});

Deno.test("an invalid status is 400, on create and on update", async () => {
  const app = await freshApp();
  const token = await userToken(app, "a@example.com");
  const created = await app.request(
    "/api/tasks",
    json({ title: "X", status: "finished" }, token),
  );
  assertEquals(created.status, 400);
  const body = await created.json();
  assertEquals(body.error, "validation failed");
  assertEquals(body.issues[0].path, ["status"]);

  const task = await makeTask(app, token, { title: "X" });
  const updated = await app.request(
    `/api/tasks/${task.id}`,
    json({ title: "X", status: "finished" }, token, "PUT"),
  );
  assertEquals(updated.status, 400);
});

Deno.test("a bad body is 400: empty title, title over 100 characters, bad date", async () => {
  const app = await freshApp();
  const token = await userToken(app, "a@example.com");
  for (
    const body of [
      {},
      { title: "   " },
      { title: "x".repeat(101) },
      { title: "ok", dueDate: "31/12/2026" },
      { title: "ok", priority: "urgent" },
    ]
  ) {
    const res = await app.request("/api/tasks", json(body, token));
    assertEquals(res.status, 400, JSON.stringify(body));
    assertEquals((await res.json()).error, "validation failed");
  }
});

Deno.test("delete: 200 { ok: true }, then the task is gone", async () => {
  const app = await freshApp();
  const token = await userToken(app, "a@example.com");
  const task = await makeTask(app, token, { title: "Bye" });

  const res = await app.request(`/api/tasks/${task.id}`, bearer(token, "DELETE"));
  assertEquals(res.status, 200);
  assertEquals(await res.json(), { ok: true });
  assertEquals((await app.request(`/api/tasks/${task.id}`, bearer(token))).status, 404);
  // a second delete finds nothing
  assertEquals(
    (await app.request(`/api/tasks/${task.id}`, bearer(token, "DELETE"))).status,
    404,
  );
});

Deno.test("pagination: 3 tasks, page 2 with limit 2 holds the third one", async () => {
  const app = await freshApp();
  const token = await userToken(app, "a@example.com");
  for (const title of ["one", "two", "three"]) await makeTask(app, token, { title });

  const res = await app.request("/api/tasks?page=2&limit=2", bearer(token));
  assertEquals(res.status, 200);
  const page = await res.json();
  assertEquals(page.page, 2);
  assertEquals(page.limit, 2);
  assertEquals(page.total, 3);
  assertEquals(page.items.map((t: { title: string }) => t.title), ["three"]);
});

Deno.test("the list defaults to page 1, limit 20", async () => {
  const app = await freshApp();
  const token = await userToken(app, "a@example.com");
  const page = await (await app.request("/api/tasks", bearer(token))).json();
  assertEquals(page, { items: [], page: 1, limit: 20, total: 0 });
});

Deno.test("filter by status: items and total both follow the filter", async () => {
  const app = await freshApp();
  const token = await userToken(app, "a@example.com");
  await makeTask(app, token, { title: "a", status: "done" });
  await makeTask(app, token, { title: "b" });
  await makeTask(app, token, { title: "c", status: "done" });

  const page = await (await app.request("/api/tasks?status=done", bearer(token))).json();
  assertEquals(page.total, 2);
  assertEquals(page.items.map((t: { title: string }) => t.title), ["a", "c"]);
});

Deno.test("a bad query string is 400, not a crash", async () => {
  const app = await freshApp();
  const token = await userToken(app, "a@example.com");
  for (
    const q of [
      "page=abc",
      "page=0",
      "limit=1000",
      "limit=0",
      "status=finished",
      "page=1.5",
    ]
  ) {
    const res = await app.request(`/api/tasks?${q}`, bearer(token));
    assertEquals(res.status, 400, q);
    assertEquals((await res.json()).error, "validation failed");
  }
});
