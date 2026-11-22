// Şevval Boyraz, 2200004208
import type { Logger } from "drizzle-orm";
import { type AppOptions, createApp } from "../src/app.ts";
import { createDb, migrate } from "../src/db.ts";

type App = ReturnType<typeof createApp>;

const quiet = () => {}; // tests do not need the request log on screen

/**
 * Every test gets a fresh, empty database in its own temporary file.
 * (An in-memory database loses its tables after a transaction with libSQL,
 * so a temporary file is the safe choice.)
 */
export async function freshApp(options: AppOptions = {}): Promise<App> {
  return (await freshSetup(options)).app;
}

/** Like freshApp, but also gives the database (and an optional query logger). */
export async function freshSetup(options: AppOptions = {}, logger?: Logger) {
  const file = await Deno.makeTempFile({ suffix: ".db" });
  const db = createDb(`file:${file}`, logger);
  await migrate(db);
  const app = createApp(db, { log: quiet, ...options });
  return { app, db };
}

export const json = (body: unknown, token?: string, method = "POST"): RequestInit => ({
  method,
  headers: {
    "content-type": "application/json",
    ...(token ? { authorization: `Bearer ${token}` } : {}),
  },
  body: JSON.stringify(body),
});

export const bearer = (token: string, method = "GET"): RequestInit => ({
  method,
  headers: { authorization: `Bearer ${token}` },
});

export const PASSWORD = "secret123";

/** Register a user and log them in. Returns the token. */
export async function userToken(app: App, email: string): Promise<string> {
  const reg = await app.request("/auth/register", json({ email, password: PASSWORD }));
  if (reg.status !== 201) throw new Error(`register failed: ${reg.status}`);
  const res = await app.request("/auth/login", json({ email, password: PASSWORD }));
  const { token } = await res.json();
  return token;
}

/** Create a task and return its JSON. */
export async function makeTask(app: App, token: string, body: Record<string, unknown>) {
  const res = await app.request("/api/tasks", json(body, token));
  if (res.status !== 201) throw new Error(`create failed: ${res.status}`);
  return await res.json();
}
