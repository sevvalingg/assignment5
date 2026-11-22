// Şevval Boyraz, 2200004208
// Bonus 11
import { z } from "zod";

const DEV_SECRET = "dev-secret";

const Config = z.object({
  APP_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().min(1).max(65535).default(8000),
  DATABASE_URL: z.string().regex(/^(file:|libsql:|https?:)/, "must start with file:")
    .default("file:./tasks.db"),
  JWT_SECRET: z.string().min(8).default(DEV_SECRET),
  // Bonus 19: the token of a hosted libSQL database (Turso). Empty for a local file.
  DATABASE_AUTH_TOKEN: z.string().optional(),
  ADMIN_EMAIL: z.email().optional(),
  // Bonus 6: how many connections the pool keeps open.
  DB_POOL_SIZE: z.coerce.number().int().min(1).max(32).default(4),
  // Bonus 14: when the purge job runs (cron syntax). "* * * * *" = every minute.
  PURGE_SCHEDULE: z.string().regex(/^(\S+\s+){4}\S+$/, "five cron fields").default(
    "0 3 * * *",
  ),
}).refine(
  (c) => c.APP_ENV !== "production" || c.JWT_SECRET !== DEV_SECRET,
  { path: ["JWT_SECRET"], message: "set a real secret in production" },
);

export type Config = z.infer<typeof Config>;

/** Parse an environment (a plain object, so tests can pass their own). Throws when bad. */
export function loadConfig(env: Record<string, string | undefined>): Config {
  // An empty value in a .env file means "not set".
  const cleaned = Object.fromEntries(
    Object.entries(env).filter(([, v]) => v !== undefined && v !== ""),
  );
  const parsed = Config.safeParse(cleaned);
  if (!parsed.success) {
    const lines = parsed.error.issues.map((i) => `  ${i.path.join(".")}: ${i.message}`);
    throw new Error(`Invalid configuration:\n${lines.join("\n")}`);
  }
  return parsed.data;
}
