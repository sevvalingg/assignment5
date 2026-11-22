// Şevval Boyraz, 2200004208
import bcrypt from "bcryptjs";
import { jwtVerify, SignJWT } from "jose";
import { eq } from "drizzle-orm";
import type { MiddlewareHandler } from "hono";
import type { Db } from "./db.ts";
import { type Role, users } from "./schema.ts";

export const hashPassword = (plain: string) => bcrypt.hash(plain, 10);
export const checkPassword = (plain: string, hash: string) => bcrypt.compare(plain, hash);

const SESSION_SECONDS = 60 * 60; // a session lives for one hour

/** Log a user in: store a random token for them and return it. */
export async function createSession(db: Db, userId: number): Promise<string> {
  const token = crypto.randomUUID();
  await db.client.execute({
    sql:
      "INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, strftime('%s','now') + ?)",
    args: [token, userId, SESSION_SECONDS],
  });
  return token;
}

/** Return the user id that owns a valid, unexpired token, or null. */
export async function userIdFromToken(db: Db, token: string): Promise<number | null> {
  const res = await db.client.execute({
    sql:
      "SELECT user_id FROM sessions WHERE token = ? AND expires_at > strftime('%s','now')",
    args: [token],
  });
  const id = res.rows[0]?.user_id;
  return id === undefined ? null : Number(id);
}

/** What the middlewares store on the context for the routes. */
export type Env = {
  Variables: {
    userId: number;
    role: Role;
    requestId: string;
  };
};

/** Read "Authorization: Bearer <token>". Anything else gives an empty string. */
function bearer(header: string | undefined): string {
  const match = /^Bearer\s+(\S+)$/i.exec(header ?? "");
  return match ? match[1] : "";
}

export type Caller = { userId: number; role: Role };

/** R3: the session way. One database lookup per request. */
export async function callerFromSession(db: Db, token: string): Promise<Caller | null> {
  if (!token) return null;
  const id = await userIdFromToken(db, token);
  if (id === null) return null;
  const [user] = await db.db.select({ role: users.role }).from(users)
    .where(eq(users.id, id));
  return user ? { userId: id, role: user.role } : null; // null: the user was removed
}

// ---------------------------------------------------------------------------
// Bonus 7: JWT. The token itself says who calls (sub) and their role, signed
// with a secret. Checking it needs no database lookup.
// ---------------------------------------------------------------------------

const key = (secret: string) => new TextEncoder().encode(secret);

export function signToken(
  secret: string,
  caller: Caller,
  expiresIn: string | number = "1h",
): Promise<string> {
  return new SignJWT({ role: caller.role })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(String(caller.userId))
    .setIssuedAt()
    .setExpirationTime(expiresIn)
    .sign(key(secret));
}

/** null for a bad signature, a changed token, a malformed one or an expired one. */
export async function verifyToken(secret: string, token: string): Promise<Caller | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, key(secret), { algorithms: ["HS256"] });
    const userId = Number(payload.sub);
    const role = payload.role;
    if (!Number.isInteger(userId) || (role !== "user" && role !== "admin")) return null;
    return { userId, role };
  } catch {
    return null;
  }
}

/** One function the middleware and the WebSocket both use, whatever the token kind. */
export type Authenticate = (token: string) => Promise<Caller | null>;

/**
 * R3: stop with 401 unless the request carries a valid token.
 * On success the user id (and, for Bonus 9, the role) is stored for the route.
 */
export const requireAuth =
  (authenticate: Authenticate): MiddlewareHandler<Env> => async (c, next) => {
    const caller = await authenticate(bearer(c.req.header("authorization")));
    if (!caller) return c.json({ error: "unauthorized" }, 401);
    c.set("userId", caller.userId);
    c.set("role", caller.role);
    await next();
  };

/** Bonus 9: 401 when nobody is logged in, 403 when the role is not allowed. */
export const requireRole =
  (...roles: Role[]): MiddlewareHandler<Env> => async (c, next) => {
    const role = c.get("role");
    if (!role) return c.json({ error: "unauthorized" }, 401);
    if (!roles.includes(role)) return c.json({ error: "forbidden" }, 403);
    await next();
  };
