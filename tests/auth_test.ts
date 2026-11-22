// Şevval Boyraz, 2200004208
import { assert, assertEquals } from "@std/assert";
import { bearer, freshApp, json, PASSWORD, userToken } from "./helpers.ts";

Deno.test("register answers 201 with id and email, never the hash", async () => {
  const app = await freshApp();
  const res = await app.request(
    "/auth/register",
    json({ email: "Ada@Example.com", password: PASSWORD }),
  );
  assertEquals(res.status, 201);
  const body = await res.json();
  assertEquals(body.email, "ada@example.com"); // stored in lower case
  assertEquals(typeof body.id, "number");
  assertEquals("passwordHash" in body, false);
  assertEquals(JSON.stringify(body).includes(PASSWORD), false);
});

Deno.test("register with an email that is taken is 409", async () => {
  const app = await freshApp();
  const creds = { email: "a@example.com", password: PASSWORD };
  assertEquals((await app.request("/auth/register", json(creds))).status, 201);
  // a different case is still the same email
  const res = await app.request(
    "/auth/register",
    json({ ...creds, email: "A@EXAMPLE.COM" }),
  );
  assertEquals(res.status, 409);
  assertEquals((await res.json()).error, "email already registered");
});

Deno.test("register with a bad body is 400 with the issues", async () => {
  const app = await freshApp();
  const res = await app.request(
    "/auth/register",
    json({ email: "not-an-email", password: "short" }),
  );
  assertEquals(res.status, 400);
  const body = await res.json();
  assertEquals(body.error, "validation failed");
  const paths = body.issues.map((i: { path: string[] }) => i.path[0]).sort();
  assertEquals(paths, ["email", "password"]);
});

Deno.test("register with a body that is not JSON is 400, not a crash", async () => {
  const app = await freshApp();
  const res = await app.request("/auth/register", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{oops",
  });
  assertEquals(res.status, 400);
  assertEquals((await res.json()).error, "validation failed");
});

Deno.test("login with the right password returns a token that works", async () => {
  const app = await freshApp();
  const token = await userToken(app, "a@example.com");
  assert(token.length > 20);
  const res = await app.request("/api/tasks", bearer(token));
  assertEquals(res.status, 200);
});

Deno.test("login with a wrong password and an unknown email give the same 401", async () => {
  const app = await freshApp();
  await userToken(app, "a@example.com");

  const wrongPassword = await app.request(
    "/auth/login",
    json({ email: "a@example.com", password: "wrong-password" }),
  );
  const unknownEmail = await app.request(
    "/auth/login",
    json({ email: "nobody@example.com", password: PASSWORD }),
  );
  assertEquals(wrongPassword.status, 401);
  assertEquals(unknownEmail.status, 401);
  assertEquals(await wrongPassword.json(), await unknownEmail.json());
});

Deno.test("an /api route without a token is 401 in the error shape", async () => {
  const app = await freshApp();
  const res = await app.request("/api/tasks");
  assertEquals(res.status, 401);
  assertEquals(await res.json(), { error: "unauthorized" });
});

Deno.test("an /api route with a made-up or malformed token is 401", async () => {
  const app = await freshApp();
  const madeUp = await app.request("/api/tasks", bearer(crypto.randomUUID()));
  assertEquals(madeUp.status, 401);
  const malformed = await app.request("/api/tasks", {
    headers: { authorization: "Token abc" },
  });
  assertEquals(malformed.status, 401);
  assertEquals((await malformed.json()).error, "unauthorized");
});

Deno.test("an unknown route is 404 in the error shape", async () => {
  const app = await freshApp();
  const res = await app.request("/nope");
  assertEquals(res.status, 404);
  assertEquals((await res.json()).error, "not found");
});
