// Şevval Boyraz, 2200004208
import type { Context } from "hono";
import { HTTPException } from "hono/http-exception";
import { OpenAPIHono } from "@hono/zod-openapi";
import { swaggerUI } from "@hono/swagger-ui";
import { and, asc, count, eq, isNotNull, isNull, sql } from "drizzle-orm";
import type { ZodError } from "zod";
import type { Db } from "./db.ts";
import { type Task, tasks, users } from "./schema.ts";
import {
  type Authenticate,
  callerFromSession,
  checkPassword,
  createSession,
  type Env,
  hashPassword,
  requireAuth,
  requireRole,
  signToken,
  verifyToken,
} from "./auth.ts";
import { createLoginLimiter } from "./ratelimit.ts";
import { LiveHub } from "./live.ts";
import type { Pool } from "./pool.ts";
import * as routes from "./routes.ts";

// ---------------------------------------------------------------------------
// Options: everything is optional, so createApp(db) alone is the required app.
// ---------------------------------------------------------------------------

export type AppOptions = {
  /** Bonus 16: a Deno KV store used as a cache. No cache when it is missing. */
  kv?: Deno.Kv;
  /** Bonus 10: where the JSON log lines go. Default console.log. */
  log?: (line: string) => void;
  /** Bonus 9: a user who registers with this email becomes an admin. */
  adminEmail?: string;
  /** Bonus 2: the title of the welcome task that register creates. Off when missing. */
  welcomeTask?: string;
  /** Bonus 15: failed logins per email per window before 429. */
  loginLimit?: { max: number; windowMs: number };
  /** Bonus 12: the folder for uploaded images. Default ./uploads */
  uploadDir?: string;
  /** Bonus 7: "jwt" (default) or the session tokens of R3. */
  auth?: "jwt" | "session";
  /** Bonus 7: the secret that signs the JWTs. */
  jwtSecret?: string;
  /** Bonus 6: a pool of connections for the task routes. Without it they use `database`. */
  pool?: Pool<Db>;
};

// Bonus 12: what may be uploaded. The first bytes must match the type, so a renamed
// .exe sent with content-type image/png is still refused.
const MAX_UPLOAD_BYTES = 1_000_000;
const IMAGE_TYPES: Record<string, { ext: string; magic: number[] }> = {
  "image/png": { ext: "png", magic: [0x89, 0x50, 0x4e, 0x47] },
  "image/jpeg": { ext: "jpg", magic: [0xff, 0xd8, 0xff] },
};
const TYPE_OF_EXT: Record<string, string> = { png: "image/png", jpg: "image/jpeg" };

/** Zod's issues in the one error shape: only path and message. */
const issuesOf = (error: ZodError) =>
  error.issues.map((i) => ({
    path: i.path.map((p) => typeof p === "symbol" ? String(p) : p),
    message: i.message,
  }));

/** Build the whole application around a database, so tests can give it their own. */
export function createApp(database: Db, options: AppOptions = {}) {
  const { db } = database;
  const { kv, adminEmail, welcomeTask } = options;
  const log = options.log ?? console.log;
  const limiter = createLoginLimiter(options.loginLimit);
  const uploadDir = options.uploadDir ?? "./uploads";
  const live = new LiveHub();

  // Bonus 7: which kind of token login gives and the middleware accepts.
  const jwtSecret = options.jwtSecret ?? "dev-secret";
  const useJwt = (options.auth ?? "jwt") === "jwt";
  const authenticate: Authenticate = useJwt
    ? (token) => verifyToken(jwtSecret, token)
    : (token) => callerFromSession(database, token);

  /** Bonus 6: borrow one pooled connection for the work of a task route. */
  const withDb = <R>(fn: (db: Db["db"]) => Promise<R>): Promise<R> =>
    options.pool ? options.pool.use((borrowed) => fn(borrowed.db)) : fn(db);

  // R5: when Zod refuses a request, answer in the one error shape.
  const app = new OpenAPIHono<Env>({
    defaultHook: (result, c) => {
      if (result.success) return;
      // "/api/tasks/abc": no task can have that id, so it is simply not found.
      if (result.target === "param") return c.json({ error: "not found" }, 404);
      return c.json({ error: "validation failed", issues: issuesOf(result.error) }, 400);
    },
  });

  const notFound = (c: Context<Env>) => c.json({ error: "not found" }, 404);

  // -------------------------------------------------------------------------
  // Bonus 10: a request id on every response and one JSON log line per request.
  // Only method, path, status and time are logged: never a body or a header,
  // so no password or token can end up in the log.
  // -------------------------------------------------------------------------
  app.use("*", async (c, next) => {
    const requestId = crypto.randomUUID();
    const start = performance.now();
    c.set("requestId", requestId);
    c.header("x-request-id", requestId);
    await next();
    log(JSON.stringify({
      requestId,
      method: c.req.method,
      path: c.req.path,
      status: c.res.status,
      ms: Math.round(performance.now() - start),
    }));
  });

  // Worked example: a health check.
  app.openapi(routes.health, (c) => c.json({ ok: true as const }, 200));

  // Bonus 11: liveness and readiness for a platform.
  app.get("/healthz", (c) => c.json({ ok: true }));
  app.get("/readyz", async (c) => {
    try {
      await db.run(sql`SELECT 1`);
      return c.json({ ready: true });
    } catch {
      return c.json({ ready: false }, 503);
    }
  });

  // -------------------------------------------------------------------------
  // R3: register and login
  // -------------------------------------------------------------------------

  app.openapi(routes.register, async (c) => {
    const { email, password } = c.req.valid("json");

    const [taken] = await db.select({ id: users.id }).from(users)
      .where(eq(users.email, email));
    if (taken) return c.json({ error: "email already registered" }, 409);

    const passwordHash = await hashPassword(password);
    const role = adminEmail && email === adminEmail.toLowerCase() ? "admin" : "user";

    try {
      // Bonus 2: the user and the welcome task are written together or not at all.
      const user = await db.transaction(async (tx) => {
        const [created] = await tx.insert(users)
          .values({ email, passwordHash, role })
          .returning({ id: users.id, email: users.email, role: users.role });
        if (welcomeTask) {
          await tx.insert(tasks).values({ userId: created.id, title: welcomeTask });
        }
        return created;
      });
      return c.json(user, 201);
    } catch (err) {
      // Two requests with the same email at the same moment: the UNIQUE index wins.
      if (String(err).includes("UNIQUE")) {
        return c.json({ error: "email already registered" }, 409);
      }
      throw err;
    }
  });

  app.openapi(routes.login, async (c) => {
    const { email, password } = c.req.valid("json");

    // Bonus 15: checked before the password, so even the right one is refused.
    const wait = limiter.retryAfterSeconds(email);
    if (wait > 0) {
      c.header("Retry-After", String(wait));
      return c.json({ error: "too many failed logins, try again later" }, 429);
    }

    const [user] = await db.select().from(users).where(eq(users.email, email));
    // The same answer for an unknown email and a wrong password.
    if (!user || !(await checkPassword(password, user.passwordHash))) {
      limiter.recordFailure(email);
      return c.json({ error: "invalid email or password" }, 401);
    }

    limiter.reset(email);
    const token = useJwt
      ? await signToken(jwtSecret, { userId: user.id, role: user.role })
      : await createSession(database, user.id);
    return c.json({ token }, 200);
  });

  // -------------------------------------------------------------------------
  // Bonus 13: live updates. A browser cannot set headers on a WebSocket, so the
  // token comes in the query string. It is checked BEFORE the upgrade.
  // -------------------------------------------------------------------------
  app.get("/ws", async (c) => {
    const caller = await authenticate(c.req.query("token") ?? "");
    if (!caller) return c.json({ error: "unauthorized" }, 401);
    if (c.req.header("upgrade")?.toLowerCase() !== "websocket") {
      return c.json({ error: "expected a WebSocket upgrade" }, 426);
    }
    const { socket, response } = Deno.upgradeWebSocket(c.req.raw);
    socket.onopen = () => live.add(caller.userId, socket);
    socket.onclose = () => live.remove(caller.userId, socket);
    return response;
  });

  // -------------------------------------------------------------------------
  // R4: every /api route needs a token, and every query includes the owner.
  // -------------------------------------------------------------------------

  app.use("/api/*", requireAuth(authenticate));

  /** id AND owner AND not soft-deleted: the only way a route finds a task. */
  const own = (id: number, userId: number) =>
    and(eq(tasks.id, id), eq(tasks.userId, userId), isNull(tasks.deletedAt));

  // Bonus 16: cache helpers. The key holds the user id, so users never share entries.
  const cacheKey = (userId: number, id: number) => ["task", userId, id];
  const forget = async (userId: number, id: number) => {
    if (kv) await kv.delete(cacheKey(userId, id));
  };

  /** "now" for a task that is done (keeping an earlier time), null otherwise. */
  const completedAtFor = (status: Task["status"]) =>
    status === "done" ? sql`COALESCE(${tasks.completedAt}, strftime('%s','now'))` : null;

  app.openapi(routes.listTasks, (c) =>
    withDb(async (db) => {
      const { page, limit, status, priority } = c.req.valid("query");
      const where = and(
        eq(tasks.userId, c.get("userId")),
        isNull(tasks.deletedAt),
        status ? eq(tasks.status, status) : undefined,
        priority ? eq(tasks.priority, priority) : undefined,
      );
      const items = await db.select().from(tasks).where(where)
        .orderBy(asc(tasks.id)).limit(limit).offset((page - 1) * limit);
      const [{ total }] = await db.select({ total: count() }).from(tasks).where(where);
      return c.json({ items, page, limit, total }, 200);
    }));

  app.openapi(routes.createTask, (c) =>
    withDb(async (db) => {
      const body = c.req.valid("json");
      const [task] = await db.insert(tasks).values({
        ...body,
        userId: c.get("userId"),
        completedAt: body.status === "done" ? sql`strftime('%s','now')` : null,
      }).returning();
      live.send(task.userId, { type: "created", task });
      return c.json(task, 201);
    }));

  app.openapi(routes.getTask, (c) =>
    withDb(async (db) => {
      const { id } = c.req.valid("param");
      const userId = c.get("userId");
      if (kv) {
        const hit = await kv.get<Task>(cacheKey(userId, id));
        if (hit.value) return c.json(hit.value, 200);
      }
      const [task] = await db.select().from(tasks).where(own(id, userId));
      if (!task) return notFound(c);
      if (kv) await kv.set(cacheKey(userId, id), task, { expireIn: 60_000 });
      return c.json(task, 200);
    }));

  app.openapi(routes.updateTask, (c) =>
    withDb(async (db) => {
      const { id } = c.req.valid("param");
      const body = c.req.valid("json");
      const userId = c.get("userId");
      const [task] = await db.update(tasks)
        .set({ ...body, completedAt: completedAtFor(body.status) })
        .where(own(id, userId))
        .returning();
      if (!task) return notFound(c);
      await forget(userId, id);
      live.send(userId, { type: "updated", task });
      return c.json(task, 200);
    }));

  // Bonus 2: DELETE is a soft delete; the row stays and can be restored.
  app.openapi(routes.deleteTask, (c) =>
    withDb(async (db) => {
      const { id } = c.req.valid("param");
      const userId = c.get("userId");
      const [task] = await db.update(tasks)
        .set({ deletedAt: sql`strftime('%s','now')` })
        .where(own(id, userId))
        .returning();
      if (!task) return notFound(c);
      await forget(userId, id);
      live.send(userId, { type: "deleted", task });
      return c.json({ ok: true as const }, 200);
    }));

  app.openapi(routes.restoreTask, (c) =>
    withDb(async (db) => {
      const { id } = c.req.valid("param");
      const userId = c.get("userId");
      const [task] = await db.update(tasks)
        .set({ deletedAt: null })
        .where(
          and(eq(tasks.id, id), eq(tasks.userId, userId), isNotNull(tasks.deletedAt)),
        )
        .returning();
      if (!task) return notFound(c);
      await forget(userId, id);
      live.send(userId, { type: "restored", task });
      return c.json(task, 200);
    }));

  // Bonus 12: attach one image to a task (a new upload replaces the old one).
  app.openapi(routes.uploadAttachment, (c) =>
    withDb(async (db) => {
      const { id } = c.req.valid("param");
      const userId = c.get("userId");
      const [task] = await db.select().from(tasks).where(own(id, userId));
      if (!task) return notFound(c);

      const form = await c.req.parseBody().catch(() => ({} as Record<string, unknown>));
      const file = form["file"];
      if (!(file instanceof File)) {
        return c.json({ error: "a file is required in the form field 'file'" }, 400);
      }
      if (file.size > MAX_UPLOAD_BYTES) {
        return c.json({ error: "file too large (1 MB)" }, 413);
      }
      const kind = IMAGE_TYPES[file.type];
      const bytes = new Uint8Array(await file.arrayBuffer());
      if (!kind || !kind.magic.every((b, i) => bytes[i] === b)) {
        return c.json({ error: "only PNG and JPEG images are allowed" }, 415);
      }

      // A generated name: the user's file name never reaches the disk (no "../" tricks).
      const name = `${crypto.randomUUID()}.${kind.ext}`;
      await Deno.mkdir(uploadDir, { recursive: true });
      await Deno.writeFile(`${uploadDir}/${name}`, bytes);
      if (task.attachment) {
        await Deno.remove(`${uploadDir}/${task.attachment}`).catch(() => {});
      }

      const [updated] = await db.update(tasks).set({ attachment: name })
        .where(own(id, userId)).returning();
      await forget(userId, id);
      live.send(userId, { type: "updated", task: updated });
      return c.json(updated, 201);
    }));

  app.openapi(routes.downloadAttachment, (c) =>
    withDb(async (db) => {
      const { id } = c.req.valid("param");
      const [task] = await db.select().from(tasks).where(own(id, c.get("userId")));
      if (!task?.attachment) return notFound(c);
      const bytes = await Deno.readFile(`${uploadDir}/${task.attachment}`)
        .catch(() => null);
      if (!bytes) return notFound(c);
      const type = TYPE_OF_EXT[task.attachment.split(".").pop() ?? ""];
      return c.body(bytes, 200, { "content-type": type ?? "application/octet-stream" });
    }));

  // Bonus 3: the number of tasks per status in ONE query (GROUP BY).
  app.openapi(routes.summary, (c) =>
    withDb(async (db) => {
      const rows = await db
        .select({ status: tasks.status, n: count() })
        .from(tasks)
        .where(and(eq(tasks.userId, c.get("userId")), isNull(tasks.deletedAt)))
        .groupBy(tasks.status);
      const result = { "todo": 0, "in-progress": 0, "done": 0, total: 0 };
      for (const { status, n } of rows) {
        result[status] = n;
        result.total += n;
      }
      return c.json(result, 200);
    }));

  // Bonus 9: admins only. requireAuth above has already set the role.
  app.use("/api/admin/*", requireRole("admin"));
  app.openapi(routes.adminUsers, async (c) => {
    const items = await db
      .select({
        id: users.id,
        email: users.email,
        role: users.role,
        createdAt: users.createdAt,
      })
      .from(users)
      .orderBy(asc(users.id));
    return c.json({ items }, 200);
  });

  // -------------------------------------------------------------------------
  // Bonus 8: the OpenAPI document and a Swagger UI page that reads it.
  // -------------------------------------------------------------------------
  app.openAPIRegistry.registerComponent("securitySchemes", "Bearer", {
    type: "http",
    scheme: "bearer",
    bearerFormat: useJwt ? "JWT" : "session token",
  });
  app.doc31("/openapi.json", {
    openapi: "3.1.0",
    info: {
      title: "Tasks API",
      version: "1.0.0",
      description: "SEN0415 Assignment 5. Log in, copy the token, press Authorize.",
    },
  });
  app.get("/docs", swaggerUI({ url: "/openapi.json" }));

  // -------------------------------------------------------------------------
  // R5: unknown routes and crashes use the same shape (Bonus 10: with the id).
  // -------------------------------------------------------------------------

  app.notFound((c) => c.json({ error: "not found", requestId: c.get("requestId") }, 404));

  app.onError((err, c) => {
    // Raised by Hono itself, e.g. a body that is not JSON or the wrong content-type.
    if (err instanceof HTTPException) {
      if (err.status === 400) {
        return c.json({
          error: "validation failed",
          issues: [{ path: [], message: "the body is not valid JSON" }],
        }, 400);
      }
      return c.json({ error: err.message || "request refused" }, err.status);
    }
    console.error(err); // the details go to the server log, never to the client
    return c.json({ error: "internal error", requestId: c.get("requestId") }, 500);
  });

  return app;
}
