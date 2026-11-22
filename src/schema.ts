// Şevval Boyraz, 2200004208
import { check, index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";

export const STATUSES = ["todo", "in-progress", "done"] as const;
export const PRIORITIES = ["low", "medium", "high"] as const;
export const ROLES = ["user", "admin"] as const;

export type Status = (typeof STATUSES)[number];
export type Priority = (typeof PRIORITIES)[number];
export type Role = (typeof ROLES)[number];

// Worked example: the users table.
export const users = sqliteTable("users", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  // Bonus 9: every user has a role, "user" unless made an admin.
  role: text("role", { enum: ROLES }).notNull().default("user"),
  // A SQL default runs for every row. A JavaScript Date.now() here would run once.
  createdAt: integer("created_at").notNull().default(sql`(strftime('%s','now'))`),
}, (t) => [check("users_role_check", sql`${t.role} IN ('user', 'admin')`)]);

// The sessions table is given: a login makes a row, a token finds it.
export const sessions = sqliteTable("sessions", {
  token: text("token").primaryKey(),
  userId: integer("user_id").notNull().references(() => users.id),
  expiresAt: integer("expires_at").notNull(),
});

// R2: one row per task. Every task belongs to exactly one user.
export const tasks = sqliteTable(
  "tasks",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    userId: integer("user_id").notNull().references(() => users.id),
    title: text("title").notNull(),
    status: text("status", { enum: STATUSES }).notNull().default("todo"),
    priority: text("priority", { enum: PRIORITIES }).notNull().default("medium"),
    // My own field: an optional due date as "YYYY-MM-DD".
    dueDate: text("due_date"),
    createdAt: integer("created_at").notNull().default(sql`(strftime('%s','now'))`),
    // Bonus 14: when the task became "done" (unix seconds), null otherwise.
    completedAt: integer("completed_at"),
    // Bonus 2: soft delete. null means the task is alive.
    deletedAt: integer("deleted_at"),
    // Bonus 12: the generated file name of an attached image ("<uuid>.png"), or null.
    attachment: text("attachment"),
  },
  (t) => [
    // Bonus 4: the list query filters on user_id and status.
    index("idx_tasks_user_status").on(t.userId, t.status),
    // The database itself refuses a wrong value, not only TypeScript.
    check("tasks_status_check", sql`${t.status} IN ('todo', 'in-progress', 'done')`),
    check("tasks_priority_check", sql`${t.priority} IN ('low', 'medium', 'high')`),
  ],
);

export type Task = typeof tasks.$inferSelect;
