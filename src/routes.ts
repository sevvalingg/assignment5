// Şevval Boyraz, 2200004208
// Bonus 8: every route described once, with the SAME Zod schemas that validate the
// requests. /openapi.json and the /docs page are built from these descriptions.
import { createRoute, z } from "@hono/zod-openapi";
import { PRIORITIES, ROLES, STATUSES } from "./schema.ts";

// ---------------------------------------------------------------------------
// Request schemas (R5): every body, query string and path parameter.
// ---------------------------------------------------------------------------

export const Credentials = z.object({
  email: z.string().trim().toLowerCase().pipe(z.email())
    .openapi({ example: "sevval@example.com" }),
  password: z.string().min(8, "password must have at least 8 characters")
    .openapi({ example: "secret123" }),
}).openapi("Credentials");

export const TaskBody = z.object({
  title: z.string().trim().min(1, "title is required").max(100)
    .openapi({ example: "README yaz" }),
  status: z.enum(STATUSES).default("todo"),
  priority: z.enum(PRIORITIES).default("medium"),
  dueDate: z.iso.date().nullable().default(null).openapi({ example: "2026-12-05" }),
}).openapi("TaskBody");

export const ListQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  status: z.enum(STATUSES).optional(),
  priority: z.enum(PRIORITIES).optional(),
});

/** A bad id ("abc") is answered with 404 by the validation hook in app.ts. */
export const IdParams = z.object({
  id: z.coerce.number().int().positive().openapi({ param: { name: "id", in: "path" } }),
});

// ---------------------------------------------------------------------------
// Response schemas
// ---------------------------------------------------------------------------

export const ErrorSchema = z.object({
  error: z.string(),
  issues: z.array(z.object({
    path: z.array(z.union([z.string(), z.number()])),
    message: z.string(),
  })).optional(),
  requestId: z.string().optional(),
}).openapi("Error");

export const TaskSchema = z.object({
  id: z.number().int(),
  userId: z.number().int(),
  title: z.string(),
  status: z.enum(STATUSES),
  priority: z.enum(PRIORITIES),
  dueDate: z.string().nullable(),
  createdAt: z.number().int().openapi({ description: "unix seconds" }),
  completedAt: z.number().int().nullable(),
  deletedAt: z.number().int().nullable(),
  attachment: z.string().nullable(),
}).openapi("Task");

const UserSchema = z.object({
  id: z.number().int(),
  email: z.string(),
  role: z.enum(ROLES),
}).openapi("User");

const PageSchema = z.object({
  items: z.array(TaskSchema),
  page: z.number().int(),
  limit: z.number().int(),
  total: z.number().int(),
}).openapi("TaskPage");

const SummarySchema = z.object({
  "todo": z.number().int(),
  "in-progress": z.number().int(),
  "done": z.number().int(),
  total: z.number().int(),
}).openapi("Summary");

const Ok = z.object({ ok: z.literal(true) });

// ---------------------------------------------------------------------------
// Small helpers so every route lists its failures, not only the success.
// ---------------------------------------------------------------------------

const json = <T extends z.ZodType>(schema: T, description: string) => ({
  content: { "application/json": { schema } },
  description,
});
const fail = (description: string) => json(ErrorSchema, description);
const E400 = fail("Validation failed");
const E401 = fail("Missing, bad or expired token");
const E404 = fail("Not found (or not yours)");
const body = <T extends z.ZodType>(schema: T) => ({
  body: { content: { "application/json": { schema } }, required: true },
});
const secured = [{ Bearer: [] }];

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

export const health = createRoute({
  method: "get",
  path: "/health",
  tags: ["health"],
  responses: { 200: json(Ok, "The server is up") },
});

export const register = createRoute({
  method: "post",
  path: "/auth/register",
  tags: ["auth"],
  request: body(Credentials),
  responses: {
    201: json(UserSchema, "The new user, without the password hash"),
    400: E400,
    409: fail("Email already registered"),
  },
});

export const login = createRoute({
  method: "post",
  path: "/auth/login",
  tags: ["auth"],
  request: body(Credentials),
  responses: {
    200: json(z.object({ token: z.string() }), "A token for the Authorization header"),
    400: E400,
    401: fail("Wrong email or password (the same message for both)"),
    429: fail("Too many failed logins; see the Retry-After header"),
  },
});

export const listTasks = createRoute({
  method: "get",
  path: "/api/tasks",
  tags: ["tasks"],
  security: secured,
  request: { query: ListQuery },
  responses: { 200: json(PageSchema, "One page of my tasks"), 400: E400, 401: E401 },
});

export const createTask = createRoute({
  method: "post",
  path: "/api/tasks",
  tags: ["tasks"],
  security: secured,
  request: body(TaskBody),
  responses: { 201: json(TaskSchema, "The new task"), 400: E400, 401: E401 },
});

export const getTask = createRoute({
  method: "get",
  path: "/api/tasks/{id}",
  tags: ["tasks"],
  security: secured,
  request: { params: IdParams },
  responses: { 200: json(TaskSchema, "One task"), 401: E401, 404: E404 },
});

export const updateTask = createRoute({
  method: "put",
  path: "/api/tasks/{id}",
  tags: ["tasks"],
  security: secured,
  request: { params: IdParams, ...body(TaskBody) },
  responses: {
    200: json(TaskSchema, "The updated task (PUT replaces all fields)"),
    400: E400,
    401: E401,
    404: E404,
  },
});

export const deleteTask = createRoute({
  method: "delete",
  path: "/api/tasks/{id}",
  tags: ["tasks"],
  security: secured,
  request: { params: IdParams },
  responses: { 200: json(Ok, "Deleted (soft delete)"), 401: E401, 404: E404 },
});

export const restoreTask = createRoute({
  method: "post",
  path: "/api/tasks/{id}/restore",
  tags: ["tasks"],
  security: secured,
  request: { params: IdParams },
  responses: {
    200: json(TaskSchema, "The restored task"),
    401: E401,
    404: fail("No deleted task with this id"),
  },
});

export const uploadAttachment = createRoute({
  method: "post",
  path: "/api/tasks/{id}/attachment",
  tags: ["attachments"],
  security: secured,
  request: {
    params: IdParams,
    body: {
      content: {
        "multipart/form-data": {
          // Checked by hand in the handler, so the three failures get their own codes.
          schema: z.object({
            file: z.any().openapi({ type: "string", format: "binary" }),
          }),
        },
      },
    },
  },
  responses: {
    201: json(TaskSchema, "The task with its attachment"),
    400: fail("No file in the form field 'file'"),
    401: E401,
    404: E404,
    413: fail("Larger than 1 MB"),
    415: fail("Not a PNG or JPEG image"),
  },
});

export const downloadAttachment = createRoute({
  method: "get",
  path: "/api/tasks/{id}/attachment",
  tags: ["attachments"],
  security: secured,
  request: { params: IdParams },
  responses: {
    200: {
      content: {
        "image/png": { schema: z.any().openapi({ type: "string", format: "binary" }) },
        "image/jpeg": { schema: z.any().openapi({ type: "string", format: "binary" }) },
      },
      description: "The image",
    },
    401: E401,
    404: fail("No task, or no attachment"),
  },
});

export const summary = createRoute({
  method: "get",
  path: "/api/me/summary",
  tags: ["tasks"],
  security: secured,
  responses: { 200: json(SummarySchema, "My tasks per status"), 401: E401 },
});

export const adminUsers = createRoute({
  method: "get",
  path: "/api/admin/users",
  tags: ["admin"],
  security: secured,
  responses: {
    200: json(
      z.object({ items: z.array(UserSchema.extend({ createdAt: z.number().int() })) }),
      "All users",
    ),
    401: E401,
    403: fail("Not an admin"),
  },
});
