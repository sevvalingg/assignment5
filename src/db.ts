// Şevval Boyraz, 2200004208
import { drizzle } from "drizzle-orm/libsql";
import { migrate as drizzleMigrate } from "drizzle-orm/libsql/migrator";
import { fileURLToPath } from "node:url";
import type { Logger } from "drizzle-orm";
import { createClient } from "@libsql/client";
import * as schema from "./schema.ts";

export type Db = ReturnType<typeof createDb>;

/**
 * Open a database. Tests pass a temporary file.
 * `logger` is optional: Bonus 3 passes one to count the queries that are sent.
 * `authToken` is only for a hosted database (Bonus 19).
 */
export function createDb(url: string, logger?: Logger, authToken?: string) {
  // Bonus 19: a hosted libSQL database (Turso) needs a token; a local file does not.
  const client = createClient({ url, authToken });
  const db = drizzle(client, { schema, logger });
  return { db, client };
}

/** Bonus 1: the migrations that Drizzle Kit generated from schema.ts (deno task db:generate). */
const MIGRATIONS = fileURLToPath(new URL("../drizzle", import.meta.url));

/**
 * Bring the database up to date. Drizzle records the migrations it has run in the
 * table __drizzle_migrations, so each file runs once, also when migrate() runs again.
 */
export async function migrate({ db }: Db) {
  await drizzleMigrate(db, { migrationsFolder: MIGRATIONS });
}
