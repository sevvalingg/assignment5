# Tasks API: Şevval Boyraz, 2200004208

## Run it

    cp .env.example .env
    deno task dev        # API on http://localhost:8000
    deno task test       # all tests (55)
    deno task check      # type-check
    deno fmt --check && deno lint

API documentation: start the API and open <http://localhost:8000/docs> (Bonus 8).

> If you used an older version of this project, delete `tasks.db` once: the tables are now
> created by the Drizzle migrations in `drizzle/` (Bonus 1).

## Try it in a browser (given, not graded)

`ui/` is a small React page that calls the API (log in, add, advance and delete tasks).
Start the API first, then in a second terminal:

    deno task ui:install   # once
    deno task ui:dev       # UI on http://localhost:5173

I only changed the UI to add `type` attributes to its buttons: without them `deno lint`
reported 6 `jsx-button-has-type` errors, and R1 asks for a clean lint.

## Design decisions (R8)

**Tables.** I have three tables. `users` keeps the email, the bcrypt hash of the password
and a role. `sessions` (given in the starter) keeps the login tokens, each valid for one
hour. `tasks` has the required columns (`id`, `user_id`, `title`, `status`, `priority`,
`created_at`) and three of my own: `due_date` (optional, `YYYY-MM-DD`), `completed_at`
(when the task became `done`, used by the clean-up job) and `deleted_at` (for soft
delete). `status` and `priority` are checked twice: by the Drizzle `enum`, so TypeScript
knows the allowed values, and by a `CHECK` in the SQL, so the database refuses a wrong
value even if it does not come through my code. `created_at` uses a SQL default, so each
row gets its own time.

**Another user's task is a 404, not a 403.** A 403 would say "this task exists, but it is
not yours", and that already gives information away: someone could try ids one by one and
learn which ones exist. With 404 the task simply does not exist for anyone but its owner.
In the code every task query goes through one helper, `own(id, userId)`, which always adds
`user_id = ?`, so I cannot forget the owner in one of the routes.

**Login gives one message for a wrong email and a wrong password.** If it said "this email
is not registered", anyone could find out which emails have an account. So both cases
answer 401 `invalid email or password`. Emails are trimmed and saved in lower case, so
`Sevval@Example.com` and `sevval@example.com` are the same account.

**Delete is a soft delete.** `DELETE` does not remove the row; it fills `deleted_at`.
Every list and lookup leaves those rows out, so for the user the task is gone (404), but
`POST /api/tasks/:id/restore` can bring it back. I liked this because a click on delete by
mistake is not final.

**PUT replaces the whole task.** The handout says the body of POST and PUT has the same
shape, so a field that is not sent goes back to its default (I saw this with `dueDate`,
see my log). The given UI only sends `title` and `status`, so advancing a task in the UI
also resets its priority to `medium`.

**Errors have one shape:** `{ "error": "...", "issues": [...] }`, with `issues` only for
validation. A body that is not JSON is treated as `{}`, so it becomes a normal 400 instead
of a crash. A non-numeric id such as `/api/tasks/abc` is a 404, because no task can have
that id.

**The list** is ordered by `id`, so the pages do not change order between requests, and
`items` and `total` use the same filter, so the total always matches what is listed.
Besides `status` I also added a `priority` filter.

### Routes

| Method and path                  | Token | Success                             | Failures                |
| -------------------------------- | ----- | ----------------------------------- | ----------------------- |
| `GET /health`                    | no    | 200 `{ ok: true }`                  |                         |
| `POST /auth/register`            | no    | 201 `{ id, email, role }`           | 400, 409                |
| `POST /auth/login`               | no    | 200 `{ token }`                     | 400, 401, 429           |
| `GET /api/tasks`                 | yes   | 200 `{ items, page, limit, total }` | 400, 401                |
| `POST /api/tasks`                | yes   | 201 the task                        | 400, 401                |
| `GET /api/tasks/:id`             | yes   | 200 the task                        | 401, 404                |
| `PUT /api/tasks/:id`             | yes   | 200 the task                        | 400, 401, 404           |
| `DELETE /api/tasks/:id`          | yes   | 200 `{ ok: true }`                  | 401, 404                |
| `POST /api/tasks/:id/restore`    | yes   | 200 the task (Bonus 2)              | 401, 404                |
| `POST /api/tasks/:id/attachment` | yes   | 201 the task (Bonus 12)             | 400, 401, 404, 413, 415 |
| `GET /api/tasks/:id/attachment`  | yes   | 200 the image (Bonus 12)            | 401, 404                |
| `GET /api/me/summary`            | yes   | 200 counts (Bonus 3)                | 401                     |
| `GET /api/admin/users`           | admin | 200 `{ items }` (Bonus 9)           | 401, 403                |
| `GET /healthz`, `GET /readyz`    | no    | 200 (Bonus 11)                      | 503                     |
| `GET /ws?token=...`              | query | WebSocket (Bonus 13)                | 401                     |
| `GET /openapi.json`, `/docs`     | no    | the API description (Bonus 8)       |                         |

## API with curl (R8)

Run on Windows in `cmd` (in PowerShell `curl` is an alias of another command and breaks
the JSON quotes, so I used `cmd` and `curl.exe`). The API runs with `deno task dev` in
another terminal.

These outputs were recorded before Bonus 7, 1 and 12: login then gave a session token (a
UUID), and tasks had no `attachment` field yet. Now login gives a JWT (see Bonus 7) and
every task also has `"attachment":null`; everything else answers the same.

```bat
> curl.exe -s localhost:8000/health
{"ok":true}

> curl.exe -s -X POST localhost:8000/auth/register -H "content-type: application/json" -d "{\"email\":\"sevval@example.com\",\"password\":\"secret123\"}"
{"id":1,"email":"sevval@example.com","role":"user"}

> curl.exe -s -X POST localhost:8000/auth/register -H "content-type: application/json" -d "{\"email\":\"sevval@example.com\",\"password\":\"secret123\"}"
{"error":"email already registered"}

> curl.exe -s -X POST localhost:8000/auth/register -H "content-type: application/json" -d "{\"email\":\"nope\",\"password\":\"123\"}"
{"error":"validation failed","issues":[{"path":["email"],"message":"Invalid email address"},{"path":["password"],"message":"password must have at least 8 characters"}]}

> curl.exe -s -X POST localhost:8000/auth/login -H "content-type: application/json" -d "{\"email\":\"sevval@example.com\",\"password\":\"yanlis-sifre\"}"
{"error":"invalid email or password"}

> curl.exe -s -X POST localhost:8000/auth/login -H "content-type: application/json" -d "{\"email\":\"sevval@example.com\",\"password\":\"secret123\"}"
{"token":"a515c9fb-cac7-4b1f-b872-dc996d0800dc"}

> set TOKEN=a515c9fb-cac7-4b1f-b872-dc996d0800dc

> curl.exe -s localhost:8000/api/tasks
{"error":"unauthorized"}

> curl.exe -s -X POST localhost:8000/api/tasks -H "Authorization: Bearer %TOKEN%" -H "content-type: application/json" -d "{\"title\":\"README yaz\",\"priority\":\"high\",\"dueDate\":\"2026-12-05\"}"
{"id":2,"userId":1,"title":"README yaz","status":"todo","priority":"high","dueDate":"2026-12-05","createdAt":1795350128,"completedAt":null,"deletedAt":null}

> curl.exe -s -X POST localhost:8000/api/tasks -H "Authorization: Bearer %TOKEN%" -H "content-type: application/json" -d "{\"title\":\"Test\",\"status\":\"finished\"}"
{"error":"validation failed","issues":[{"path":["status"],"message":"Invalid option: expected one of \"todo\"|\"in-progress\"|\"done\""}]}

> curl.exe -s "localhost:8000/api/tasks?page=1&limit=2" -H "Authorization: Bearer %TOKEN%"
{"items":[{"id":1,"userId":1,"title":"Welcome! Move me to done when you have read the README.","status":"todo","priority":"medium","dueDate":null,"createdAt":1795349593,"completedAt":null,"deletedAt":null},{"id":2,"userId":1,"title":"README yaz","status":"todo","priority":"high","dueDate":"2026-12-05","createdAt":1795350128,"completedAt":null,"deletedAt":null}],"page":1,"limit":2,"total":2}

> curl.exe -s "localhost:8000/api/tasks?limit=1000" -H "Authorization: Bearer %TOKEN%"
{"error":"validation failed","issues":[{"path":["limit"],"message":"Too big: expected number to be <=100"}]}

> curl.exe -s localhost:8000/api/tasks/2 -H "Authorization: Bearer %TOKEN%"
{"id":2,"userId":1,"title":"README yaz","status":"todo","priority":"high","dueDate":"2026-12-05","createdAt":1795350128,"completedAt":null,"deletedAt":null}

> curl.exe -s -X PUT localhost:8000/api/tasks/2 -H "Authorization: Bearer %TOKEN%" -H "content-type: application/json" -d "{\"title\":\"README yaz\",\"status\":\"done\",\"priority\":\"high\"}"
{"id":2,"userId":1,"title":"README yaz","status":"done","priority":"high","dueDate":null,"createdAt":1795350128,"completedAt":1795350173,"deletedAt":null}

> curl.exe -s -X DELETE localhost:8000/api/tasks/2 -H "Authorization: Bearer %TOKEN%"
{"ok":true}

> curl.exe -s localhost:8000/api/tasks/2 -H "Authorization: Bearer %TOKEN%"
{"error":"not found"}
```

### Another user cannot touch my task (R4)

A second user logs in and tries to read, change and delete task 2. All three answer 404,
and my task is unchanged.

```bat
> curl.exe -s -X POST localhost:8000/auth/register -H "content-type: application/json" -d "{\"email\":\"lamineyamal@example.com\",\"password\":\"secret123\"}"
{"id":2,"email":"lamineyamal@example.com","role":"user"}

> curl.exe -s -X POST localhost:8000/auth/login -H "content-type: application/json" -d "{\"email\":\"lamineyamal@example.com\",\"password\":\"secret123\"}"
{"token":"afb78879-9822-4933-9efa-05422c1efb8c"}

> set TOKEN2=afb78879-9822-4933-9efa-05422c1efb8c

> curl.exe -s localhost:8000/api/tasks/2 -H "Authorization: Bearer %TOKEN2%"
{"error":"not found"}

> curl.exe -s -X PUT localhost:8000/api/tasks/2 -H "Authorization: Bearer %TOKEN2%" -H "content-type: application/json" -d "{\"title\":\"Hacklendi\"}"
{"error":"not found"}

> curl.exe -s -X DELETE localhost:8000/api/tasks/2 -H "Authorization: Bearer %TOKEN2%"
{"error":"not found"}

> curl.exe -s localhost:8000/api/tasks/2 -H "Authorization: Bearer %TOKEN%"
{"id":2,"userId":1,"title":"README yaz","status":"done","priority":"high","dueDate":null,"createdAt":1795350128,"completedAt":1795350173,"deletedAt":null}
```

## My own log (R8)

1. **The project files were not where I thought.** My first command failed:

   ```
   cp : Cannot find path 'C:\Users\Şevval\Downloads\assignment5\.env.example' because it does not exist.
   ```

   I thought `.env.example` was missing from the zip. `ls` showed only one folder,
   `assignment5`: Windows "Extract all" had put the zip's own `assignment5` folder inside
   a new folder with the same name. After `cd assignment5` everything was there.

2. **curl in PowerShell is not curl.** In PowerShell, `curl` is an alias of another
   command (`Invoke-WebRequest`), and it also breaks the double quotes inside the JSON
   body. I switched to `cmd` and called `curl.exe` directly, escaping the quotes as `\"`.
   All the examples in this README are run that way.

3. **PUT removed my due date.** I created a task with `"dueDate":"2026-12-05"` and then
   sent a PUT with only `title`, `status` and `priority`. The answer had `"dueDate":null`.
   At first I thought the update was broken. It is the design: PUT replaces the whole task
   and the body has the same shape as POST, so a field that is not sent goes back to its
   default. A client that wants to keep it has to send it again (a PATCH route would be
   the other option).

4. **The scripts crashed on Windows at the very end.** `deno task explain` and
   `deno task nplus1` printed their results and then stopped with:

   ```
   error: Uncaught (in promise) Error: Dosya başka bir işlem tarafından kullanıldığından bu işlem dosyaya erişemiyor. (os error 32): remove 'C:\Users\EVVAL~1\AppData\Local\Temp\d68a12e9352bd3d5.db'
   ```

   ("the file is being used by another process"). The scripts delete their temporary
   database at the end, but on Windows the file is still locked right after
   `client.close()`. The results were correct; only the clean-up failed. I put
   `Deno.remove(file)` inside `try/catch`: a leftover file in the temp folder is harmless.

5. **The server restarted by itself.** While the API was running, the first terminal
   showed:

   ```
   Watcher Restarting! File change detected: "C:\Users\Şevval\Downloads\assignment5\assignment5\src\db.ts"
   ```

   and the old log lines were gone from the screen. `deno task dev` runs with `--watch`,
   so every change to a source file restarts the server (here: when the name comment at
   the top of the files was changed). My users, tasks and tokens were still there after
   the restart, because they are in `tasks.db` and not in memory. To get a new log line
   for Bonus 10, I sent one more request to `/health`.

## Bonuses claimed

<!-- Delete every section below that you do not hand in, and fill in the TODOs. -->

### Bonus 1: Migrations with Drizzle Kit

`migrate()` no longer holds hand-written SQL. `deno task db:generate` reads `schema.ts`
and writes the SQL files in `drizzle/`; at start-up `migrate()` runs the ones that have
not run yet (Drizzle keeps the list in the table `__drizzle_migrations`).

- `drizzle/0000_init.sql`: the three tables, the index and the `CHECK` rules.
- `drizzle/0001_add_attachment.sql`: my second change. I added a nullable `attachment`
  column to `tasks` in `schema.ts` (for Bonus 12), ran
  `deno task db:generate --name
  add_attachment` and got one line:
  ``ALTER TABLE `tasks` ADD `attachment` text;``.

So a change to the schema is now: edit `schema.ts`, generate, commit the new file. An old
database gets only the new `ALTER TABLE`; with `CREATE TABLE IF NOT EXISTS` it would have
kept the old table. I also moved the `CHECK` rules for status, priority and role into
`schema.ts` (`check()`), so the generated SQL still refuses a wrong value. The task needs
`--node-modules-dir=auto --allow-scripts`, because Drizzle Kit loads the config with
esbuild, which must run its install script first. Tests: both migrations run once, a
second `migrate()` changes nothing, and the database refuses `status = 'finished'`.

### Bonus 2: Soft delete, restore and a transaction

`DELETE` sets `deleted_at`; every lookup and list adds `deleted_at IS NULL` through
`own()`. `POST /api/tasks/:id/restore` clears it, and answers 404 when the task is not
deleted. Register writes the user and a welcome task in one `db.transaction`. Tests in
`tests/bonus_test.ts`: deleted then not listed, restore, another user cannot restore, and
a rolled-back registration (the test drops the `tasks` table so that the second insert
throws, then checks that the `users` table is still empty).

```bat
> curl.exe -s -X POST localhost:8000/api/tasks/2/restore -H "Authorization: Bearer %TOKEN%"
{"id":2,"userId":1,"title":"README yaz","status":"done","priority":"high","dueDate":null,"createdAt":1795350128,"completedAt":1795350173,"deletedAt":null}
```

### Bonus 3: Joins and the N+1 problem

`GET /api/me/summary` uses one `GROUP BY status` query. `deno task nplus1` runs a naive
version and the good one on 30 tasks and counts the queries with a Drizzle logger:

```
naive: 31 queries -> {"done":10,"in-progress":10,"todo":10}
  first: select "id", "user_id", "title", "status", "priority", "due_date", "created_at", "completed_at", "deleted_at" from "tasks" where "tasks"."user_id" = ?
  then 30 times: select count(*) from "tasks" where ("tasks"."user_id" = ? and "tasks"."status" = ?)
grouped: 1 queries -> {"done":10,"in-progress":10,"todo":10}
  first: select "status", count(*) from "tasks" where "tasks"."user_id" = ? group by "tasks"."status"
```

The naive version sends 1 query plus 1 per task, so it grows with the data (1,000 tasks =
1,001 queries). The grouped version is always one query; the database does the counting.

```bat
> curl.exe -s localhost:8000/api/me/summary -H "Authorization: Bearer %TOKEN%"
{"todo":1,"in-progress":0,"done":1,"total":2}
```

### Bonus 4: Indexes and EXPLAIN

`deno task explain` fills a temporary database with 20,000 tasks for 20 users and compares
the plan and the median time of 50 runs, without and with
`idx_tasks_user_status ON tasks(user_id, status)` (also in `schema.ts` and `migrate()`):

```
20,000 tasks. Query: SELECT * FROM tasks WHERE user_id = ? AND status = ?  [7, done]
before: SCAN tasks
        median 3.725 ms
after:  SEARCH tasks USING INDEX idx_tasks_user_status (user_id=? AND status=?)
        median 2.375 ms
```

The plan changes from `SCAN` (read all 20,000 rows) to `SEARCH` (jump straight to the rows
of user 7 with status `done`). The time only drops by about 1 ms, because the query still
returns about 333 full rows and most of the time goes into reading and sending them. The
index would matter much more with more data or with a `LIMIT`. An index is not free: it
takes extra space on disk, and every `INSERT` and `UPDATE` on `tasks` must update the
index too, so writing becomes a little slower.

### Bonus 5: Seed data

`deno task seed` creates `demo@example.com` and `admin@example.com` (an admin), password
`demo-password`, with 10 tasks each. A second run skips both users (`onConflictDoNothing`)
and their tasks. It refuses to run when `APP_ENV=production`.

```
> deno task seed
admin@example.com: added 10 tasks
demo@example.com: added 10 tasks
> deno task seed
admin@example.com: already has 10 tasks, skipped
demo@example.com: already has 10 tasks, skipped
> set APP_ENV=production
> set JWT_SECRET=a-long-real-secret
> deno task seed
Refusing to seed a production database.
```

### Bonus 6: A connection pool (Postgres or SQLite)

**I did option B**: a pool of my own on SQLite (`src/pool.ts`). `acquire()` gives an idle
connection or waits in a queue, `release()` hands it straight to the one who waited
longest, and `use(fn)` always releases in a `finally`, also when `fn` throws.
`createDbPool()` opens N libSQL clients on the same file with `PRAGMA journal_mode = WAL`
(readers do not block the writer) and `PRAGMA busy_timeout = 5000` (wait for a lock
instead of failing). Every task route borrows one connection for the request (`withDb()`
in `app.ts`). Tests: 20 jobs on a pool of 3 never run more than 3 at once and all finish,
a job that throws still gives its connection back, and 10 requests at the same time
through the pool all succeed.

**Size:** 4 (`DB_POOL_SIZE`). One SQLite file has only one writer at a time, so more
connections do not make writes faster; a few are enough for reads to go in parallel.
**When all are busy** the request waits in the queue until one is released; nothing fails.
**Why SQLite gains little:** SQLite runs inside my process and opening it costs almost
nothing, while a Postgres connection is a network connection with a login, which is slow
to open and limited on the server. A pool saves that cost; SQLite never had it.

### Bonus 7: JWT instead of sessions

Login now returns a JWT signed with `JWT_SECRET` (HS256, `jose`). The user id is in `sub`,
the role in a `role` claim, and it expires after one hour. `requireAuth` and `/ws` call
`verifyToken()`, which returns `null` for a bad signature, a changed token, an expired one
or one signed with another secret. The session tokens of R3 still exist:
`createApp(db, { auth: "session" })` uses them, and a test proves they still work. In
production the default secret is refused (Bonus 11). Tests: tampered, expired and
foreign-secret tokens are 401, and the session mode still works.

|                        | Session (R3)                    | JWT (Bonus 7)                               |
| ---------------------- | ------------------------------- | ------------------------------------------- |
| Check a request        | one database lookup             | only the signature, no database             |
| Several servers        | all need the same database      | only the same secret                        |
| Log out / block a user | delete the session row, at once | not possible before it expires              |
| Role change            | seen at once                    | seen at the next login (it is in the token) |

### Bonus 8: OpenAPI and a docs page

The app is an `OpenAPIHono`. Every route is described once in `src/routes.ts` with
`createRoute`, using the same Zod schemas that validate the requests, so the documentation
cannot drift away from the code. `/openapi.json` (OpenAPI 3.1) lists all routes with their
400/401/403/404/409/413/415/429 answers, and `/docs` is a Swagger UI page. A `Bearer`
security scheme marks every `/api` route, so the page has an **Authorize** button: log in
with "Try it out" on `/auth/login`, copy the token, press Authorize, and then try
`/api/tasks`. A validation failure still answers in my one error shape (the `defaultHook`
in `app.ts`), and a bad id in the path is a 404. Tests check that every route and its 401
is in the document and that `/docs` loads it.

What I did on <http://localhost:8000/docs>: `POST /auth/register` with "Try it out" (201;
pressing Execute a second time gave 409 `email already registered`), then
`POST
/auth/login`, which gave a JWT. I pasted it into **Authorize** and ran
`GET /api/tasks`:

```json
{
  "items": [
    {
      "id": 2,
      "userId": 2,
      "title": "Welcome! Move me to done when you have read the README.",
      "status": "todo",
      "priority": "medium",
      "dueDate": null,
      "createdAt": 1795358872,
      "completedAt": null,
      "deletedAt": null,
      "attachment": null
    }
  ],
  "page": 1,
  "limit": 20,
  "total": 1
}
```

### Bonus 9: Roles (RBAC)

Users have a `role` column (`user` by default, or `admin`). An admin comes to exist in two
ways: the seed script, or registering with the email in `ADMIN_EMAIL`. `requireAuth` reads
the role from the users table and stores it next to `userId`; `requireRole("admin")`
protects `GET /api/admin/users`.

**401 versus 403:** 401 means "I do not know who you are" (no or bad token: log in); 403
means "I know who you are, and you are not allowed" (logging in again will not help).

```bat
> curl.exe -s localhost:8000/api/admin/users -H "Authorization: Bearer %TOKEN%"
{"error":"forbidden"}
```

### Bonus 10: Logging and request ids

A middleware gives every request a `crypto.randomUUID()`, sends it as `x-request-id`, and
writes one JSON line after the route has run. The 404 and 500 bodies carry the same id.
Only method, path, status and time are logged, never a body or a header, so a password or
a token cannot reach the log; a test logs in and checks that neither the password nor the
token appears in any line.

```
{"requestId":"4cee2b27-d3b4-4e41-85d0-6ae41f718b3b","method":"GET","path":"/health","status":200,"ms":1}
```

```bat
> curl.exe -si localhost:8000/nope
HTTP/1.1 404 Not Found
content-type: application/json
x-request-id: eabd9c72-64e2-40f2-bdf8-6349494c3bf2
content-length: 72
date: Sun, 22 Nov 2026 12:28:41 GMT

{"error":"not found","requestId":"eabd9c72-64e2-40f2-bdf8-6349494c3bf2"}
```

### Bonus 11: Health, readiness and configuration

`/healthz` answers when the process is up; `/readyz` runs `SELECT 1` and answers 503 when
the database fails (a test closes the client to prove it). `src/config.ts` reads
`APP_ENV`, `PORT`, `DATABASE_URL`, `JWT_SECRET` and `ADMIN_EMAIL` once, checks them with
Zod and stops at start-up with a clear message. In production the default secret is
refused. Use `deno task start:prod` with a `.env.production` made from
`.env.production.example`.

```
> set PORT=abc
> deno task start
Task start deno run -A src/main.ts
Invalid configuration:
  PORT: Invalid input: expected number, received NaN
```

### Bonus 12: File upload

`POST /api/tasks/:id/attachment` takes a form with a `file` field. No file is 400, more
than 1 MB is 413, anything but PNG or JPEG is 415. The type is checked twice: the
content-type and the first bytes of the file, so a text file that only _claims_ to be
`image/png` is refused. The file is saved under a generated name (`<uuid>.png`) in
`uploads/`, never under the user's name (a name like `../../evil.png` cannot escape the
folder); `uploads/` is in `.gitignore`. A new upload replaces the old file.
`GET /api/tasks/:id/attachment` returns the bytes with the right content-type, only to the
owner. Tests: the three failures, upload and download of the same bytes, and another user
gets 404 for both.

I tried it on the docs page (`/docs`), logged in with **Authorize**. Uploading a PNG
screenshot to task 2 gave 201; the saved name is a UUID, not my file's name:

```json
{
  "id": 2,
  "userId": 2,
  "title": "Welcome! Move me to done when you have read the README.",
  "status": "todo",
  "priority": "medium",
  "dueDate": null,
  "createdAt": 1795358872,
  "completedAt": null,
  "deletedAt": null,
  "attachment": "dbbc46fc-18ab-409e-b089-737c63217103.png"
}
```

`GET /api/tasks/2/attachment` showed the same picture. Uploading a file that is not an
image gave 415:

```json
{
  "error": "only PNG and JPEG images are allowed"
}
```

My first try gave 401 for both: I had reloaded the docs page, and Swagger UI forgets the
token on a reload, so I had to press **Authorize** again.

### Bonus 13: WebSocket live updates

`GET /ws?token=...` checks the token **before** `Deno.upgradeWebSocket` (401 otherwise); a
browser cannot set headers on a WebSocket, so the token travels in the query string.
`src/live.ts` keeps a `Map<userId, Set<WebSocket>>`: a socket is added on open and removed
on close. After a create, update, delete, restore or upload, `{ type, task }` goes to that
user's sockets only. A test starts a real server, opens a socket for user A and one for
user B, creates a task as A, and checks that A's socket got `created` and B's got nothing.

What I did: I opened a second browser tab on `http://localhost:8000/health` and, in the
developer console (F12), connected with my token:

```js
const ws = new WebSocket("ws://localhost:8000/ws?token=<my JWT>");
ws.onopen = () => console.log("bağlandı");
ws.onmessage = (e) => console.log("canlı:", e.data);
```

The console printed `bağlandı`. Then, in the docs tab, I created a task with the title
"Canlı test". Without reloading anything, the first tab printed at once:

```
canlı: {"type":"created","task":{"id":3,"userId":2,"title":"Canlı test","status":"todo","priority":"medium","dueDate":null,"createdAt":1795361923,"completedAt":null,"deletedAt":null,"attachment":null}}
```

### Bonus 14: A background job with Deno.cron

`purgeOldDone(db, days)` in `src/jobs.ts` deletes the tasks that have been `done` for more
than `days` days (by `completed_at`). It is registered in `main.ts` for 03:00 every night;
`PURGE_SCHEDULE` (checked in `config.ts`) changes that, so `PURGE_SCHEDULE=* * * * *` runs
it every minute to see it work. It is idempotent: a second run finds nothing left.
`"unstable": ["kv", "cron"]` in `deno.json` turns on the flag for every task.

On my computer, in PowerShell:

```
> $env:PURGE_SCHEDULE="* * * * *"
> deno task dev
Listening on http://localhost:8000/
{"job":"purge","at":"2026-11-22T14:44:00.018Z","removed":0}
```

`removed: 0` because no task had been done for more than 30 days; the test of
`purgeOldDone` shows a run that does remove a row.

### Bonus 15: Rate limit on login

After 5 failed logins for one email within a minute, login answers 429 with `Retry-After`,
even with the right password. A success clears the counter. **What this does not protect
against:** the counter is in memory, so it is reset on a restart and is not shared between
several servers; and it counts per email, so an attacker who tries one password on many
emails is never blocked (that needs a limit per IP address as well).

### Bonus 16: A cache with Deno KV

`GET /api/tasks/:id` is cached for 60 seconds under `["task", userId, id]`; PUT, DELETE
and restore delete the entry. Tests count the SQL reads of the tasks table with a Drizzle
logger: two reads of the same task send one query. Another test checks that the key
includes the user.

### Bonus 17: Docker

<!-- TODO: run these and paste the real output (image size too). -->

    docker build -t tasks-api .
    docker volume create tasksdata
    docker run -d --rm --name tasks -p 8000:8000 -v tasksdata:/data tasks-api

### Bonus 18: Continuous integration

`.github/workflows/ci.yml` runs `deno fmt --check`, `deno lint`, `deno task check` and
`deno task test` on every push and pull request.

- **Green run** (first push of `main`, all 55 tests pass):
  <https://github.com/sevvalingg/assignment5/actions/runs/45033642125>
- **Red run** (branch `ci-red-demo`, where I changed `{ ok: true }` to `{ ok: false }` in
  `tests/health_test.ts` on purpose): fmt, lint and check pass, `deno task test` fails.
  <https://github.com/sevvalingg/assignment5/actions/runs/45033950461>

The broken test was never merged: I deleted the branch, and `main` stayed green. The first
run also warned that `actions/checkout@v4` uses Node.js 20, which GitHub is retiring, so I
moved it to `actions/checkout@v5`.

### Bonus 19: Deploy

<!-- TODO: fill in after you deployed. The code is ready: DATABASE_URL=libsql://... and
DATABASE_AUTH_TOKEN go to createClient({ url, authToken }); the PRAGMAs are skipped for
a hosted database. Uploads (Bonus 12) need a disk, so they do not work on Deno Deploy. -->

Public URL: <!-- TODO --> (`/health` answers `{"ok":true}`)

### Bonus 20: Git repository

Repository: <https://github.com/sevvalingg/assignment5> (public, so the instructor can
open it with the link). `.gitignore` leaves out `.env`, `*.db`, `node_modules` and
`uploads/`, and `.gitattributes` keeps LF line endings, so `deno fmt --check` passes on
Windows and in CI. After `git clone` it runs with only Deno: `deno task test`.
