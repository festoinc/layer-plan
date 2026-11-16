# Phase 6 — Authentication, accounts and project ownership

Status: delivered  
Date: 2026-11-15

## Goal

Add local authentication and user accounts to the phase 5 API, and make every
project privately owned by a user.

Phase 6 delivers:

- a super admin configured from `.env`;
- email/password sign-in for browser users;
- an account page and an admin page for creating users;
- private project ownership and server-enforced isolation;
- browser sessions using an opaque `HttpOnly` cookie;
- bearer API tokens for local AI agents;
- per-user active project and activity attribution;
- OpenAPI security schemes, contract tests and browser coverage for every auth
  state.

Phase 6 stays local-only. It does not add project sharing, invitations, project
roles, email delivery, password recovery, remote hosting or TLS. Those remain in
P-02 and later ideas.

## Locked decisions

| Topic | Decision |
| --- | --- |
| Scope | Authentication, accounts and private project ownership (idea P-01, option A) |
| Deployment | Local only; loopback bind remains the default; remote/TLS is out of scope |
| Login identity | Email plus password; display name is optional |
| Super admin | Configured in `.env`; synchronized into the database at startup |
| Registration | No self-registration; the super admin creates users |
| User creation | Super admin UI and API; created users always have the `member` role |
| Password lifecycle | No forgot-password, no self-service password change, no admin password reset in this phase |
| Browser auth | Opaque random session token in an `HttpOnly`, `SameSite=Lax` cookie |
| Agent auth | Bearer API tokens, stored hashed, with `read`/`write` scopes |
| Password hashing | Argon2id via `@node-rs/argon2` |
| Authorization | A user can access only projects they own; foreign ids return `404` |
| Super admin projects | The super admin manages users but does not automatically read other users' projects |
| Active project | Per-user state |
| Selected chapter | Remains in the project document; not moved in this phase |
| Project ownership transfer | Not included |
| Activity attribution | New activity records the acting user; legacy activity is attributed to the super admin when claimed |
| API contract | OpenAPI security schemes, Zod validation and generated types |
| Environment file | `.env` loaded with `dotenv`; `.env.example` is committed and `.env` is ignored |
| Quality gate | Existing gate plus auth unit, API, contract and Playwright tests |

### Derived choices to review

These follow from the answers above but were not stated explicitly. Change them
before implementation if they are wrong.

- **Email is the unique login identifier.** The super admin creates users by
  email and password, so a separate username would be redundant. Display names
  default to the email local part when omitted. This supersedes the earlier
  username-first proposal.
- **The super admin is a singleton database user.** On startup, the server
  creates the `super_admin` user if it does not exist. If it exists, the server
  updates its email, display name and password in place from `.env`, keeping the
  same user id and owned projects. A partial unique index prevents a second
  super admin.
- **Created users are always members.** The super admin cannot create another
  super admin, change roles, edit emails/display names, reset passwords or
  delete users. Disabling and re-enabling a user is exposed because it is the
  only way to revoke access.
- **Changing the super admin password in `.env` revokes that user's sessions.**
  Changing only the email or display name keeps sessions.
- **No password change/reset exists at all in this phase.** A forgotten
  password requires disabling the account and creating a new one, or a database
  reset. This is a known limitation and a risk, not an oversight.
- **The active project moves to per-user state.** `app_state.active_project_id`
  is global today and cannot remain global once catalogs differ per user. This
  is the only “move” in the phase: project records themselves are never
  transferred between users.
- **`selectedId` stays in `project_documents`.** With private ownership there is
  only one user per project, so per-user selection is not required yet.
- **Existing projects and activity are claimed by the super admin** on first
  startup after migration. Seeded sample projects are also owned by the super
  admin, so member accounts start with an empty project list.
- **`projects.owner_id` is nullable in SQLite for migration**, but every write
  sets it. Startup claims legacy ownerless rows. A later migration can rebuild
  the table with `NOT NULL` once no legacy database remains.
- **Activity attribution is included now** because identity makes it
  meaningful and it advances P-04. Exported `layers-project` v3 files keep the
  phase 5 activity shape and do not include actor fields.
- **API tokens cannot manage users, sessions or other tokens.** Token
  management and super-admin actions require a cookie session. Bearer tokens
  are for project/document/activity/coverage/export/import work.
- **Public endpoints are `/health`, `/openapi.json`, `/docs`, `/auth/login` and
  `/auth/logout`.** Everything else requires authentication or a bearer token.
- **The API stays under `/api/v1`.** Existing agents must switch to a bearer
  token; this breaking change is documented in the phase notes, README and
  `AGENTS_template.md`.
- **Cookie-authenticated state-changing requests require an allowed `Origin`
  when the header is present.** Bearer requests skip this check.
- **CORS is tightened.** Only exact local UI origins are allowed, with
  credentials enabled. The old “any localhost port” regex is removed.
- **Login rate limiting is relaxed in test mode** so E2E runs do not trip it;
  a dedicated test asserts the production limit.
- **Test mode provides default super-admin credentials** when
  `LAYERS_TEST_MODE=1`. Non-test startup fails fast if the required `.env`
  values are missing.
- **The phase keeps the phase 5 export format version 3.** Imports assign the
  importing user as owner and ignore any actor fields.

## 1. Configuration, environment and startup

### New environment variables

| Variable | Default | Meaning |
| --- | --- | --- |
| `LAYERS_SUPER_ADMIN_EMAIL` | none; required outside test mode | Super-admin login email |
| `LAYERS_SUPER_ADMIN_PASSWORD` | none; required outside test mode | Super-admin password, at least 12 characters |
| `LAYERS_SUPER_ADMIN_NAME` | `Super Admin` | Super-admin display name |
| `LAYERS_SESSION_TTL_DAYS` | `30` | Sliding browser-session lifetime |
| `LAYERS_SECURE_COOKIES` | `0` | Set `Secure` on the session cookie; enable behind HTTPS |
| `LAYERS_UI_ORIGIN` | `http://127.0.0.1:5173` | Additional allowed browser origin for CORS/CSRF |
| `LAYERS_LOGIN_RATE_LIMIT` | `5`; `1000` in test mode | Login attempts per window |
| `LAYERS_LOGIN_RATE_WINDOW_MINUTES` | `15` | Login rate-limit window |

Existing variables keep their meaning: `HOST`, `PORT`, `LAYERS_DB_PATH`,
`LAYERS_SEED_SAMPLES`, `LAYERS_TEST_MODE`, `LAYERS_ALLOW_REMOTE` and
`VITE_API_URL`.

### `.env` handling

- Add `dotenv` and load `.env` before `loadConfig` reads the environment.
- Commit `.env.example`:

```dotenv
LAYERS_SUPER_ADMIN_EMAIL=admin@example.com
LAYERS_SUPER_ADMIN_PASSWORD=replace-with-at-least-12-characters
LAYERS_SUPER_ADMIN_NAME=Super Admin
```

- Add `.env` to `.gitignore`.
- README setup becomes:

```sh
cp .env.example .env
# edit the super-admin email and password
npm run dev
```

- The password is stored in plaintext in `.env` by design. Document that the
  file must not be committed, that shell history can leak values, and that the
  local filesystem permissions are part of the security boundary.
- `npm run dev`, `npm start`, `npm run db:reset` and the server bootstrap
  require the three super-admin values outside test mode.
- `LAYERS_TEST_MODE=1` supplies defaults:
  `super@example.test` / `test-super-admin-password` / `Super Admin`.
- `npm run db:migrate` uses a light config path and does not require auth env
  values; it only needs `LAYERS_DB_PATH`.

### Startup sequence

`server/index.ts` becomes:

1. load config and `.env`;
2. open SQLite;
3. run migrations;
4. create `SqliteStore` and `SqliteAuthStore`;
5. call a shared `bootstrap` routine;
6. build and listen with Fastify.

`bootstrap` is shared by the server, `db:reset`, test helpers and the test-only
reset endpoint. It performs, in one place:

1. `ensureSuperAdmin` — create or synchronize the singleton `super_admin`;
2. `claimUnownedProjects(superAdmin.id)` — assign legacy projects and their
   activity to the super admin;
3. migrate the legacy `app_state.active_project_id` into the super admin's
   `user_state` row, then clear the legacy key;
4. prune expired sessions and expired API tokens;
5. seed sample projects when the database has no projects and
   `LAYERS_SEED_SAMPLES=1`, assigning them to the super admin.

Failure to create or synchronize the super admin stops startup with a clear
message. The server must never run without a usable super admin.

### Dependencies

Runtime:

- `@fastify/cookie` — session cookie parsing and setting;
- `@fastify/rate-limit` — login throttling;
- `@node-rs/argon2` — Argon2id password hashing;
- `dotenv` — `.env` loading.

Development/testing:

- no new test framework;
- existing Vitest and Playwright suites are extended.

Exact versions are chosen during implementation.

### Scripts

Existing scripts stay, with these changes:

- `dev:e2e` and `test:prod` keep `LAYERS_TEST_MODE=1` so test super-admin
  defaults are available;
- `db:reset` runs the full bootstrap, including super-admin creation and
  seeded-owner assignment;
- `db:migrate` remains schema-only;
- `api:types` is regenerated after the OpenAPI security changes.

## 2. Authentication model

### Identity and passwords

- **Email** is trimmed, lowercased and must be a valid address up to 254
  characters. It is unique, case-insensitively.
- **Display name** is optional, 1–80 characters, defaulting to the email local
  part.
- **Password** is 12–200 characters. There are no composition rules. Passwords
  are never logged, returned or stored in plaintext.
- **Argon2id** parameters follow current OWASP guidance: 19 MiB memory, 2
  iterations, 1 lane. Test mode uses reduced parameters so the suite stays fast;
  production mode always uses the secure defaults.
- Login uses a constant-time verification path and verifies against a dummy
  hash when the email is unknown, so response timing does not reveal account
  existence.
- If the stored hash uses older parameters, it is rehashed on a successful
  login. This is the only password mutation in the phase.
- Failed login returns `401 invalid_credentials` with a generic message.
  A correct password for a disabled account returns `403 account_disabled`.

### Super admin

- The super admin is a normal row in `users` with role `super_admin`.
- A partial unique index allows exactly one such row.
- On startup `ensureSuperAdmin`:
  - creates the row when missing;
  - verifies the `.env` password against the stored hash and rehashes only when
    it changed;
  - updates email and display name in place;
  - clears `disabled_at`;
  - revokes all super-admin sessions when the password changed.
- If the new email collides with a member account, startup fails with an
  explicit error. The operator must resolve the collision before the server can
  start.
- The super admin has no implicit access to other users' projects. It can only
  manage users.

### Sessions

- Login generates 32 random bytes encoded as base64url. The cookie value is the
  token; SQLite stores only its SHA-256 hash.
- Cookie name: `layers_session`.
- Cookie options: `HttpOnly`, `SameSite=Lax`, `Path=/`, `Secure` when
  `LAYERS_SECURE_COOKIES=1`, and `Max-Age` matching the session TTL.
- The session row stores `id`, `user_id`, `token_hash`, `created_at`,
  `last_seen_at`, `expires_at` and a truncated `user_agent`.
- Sessions slide: authenticated requests extend `expires_at` by the TTL, but
  `last_seen_at` and `expires_at` are written at most once per hour to avoid a
  SQLite write on every request.
- Logout deletes the current session and clears the cookie. Logout is
  idempotent.
- Disabling a user deletes all of that user's sessions.
- Expired sessions are deleted when encountered and pruned at startup and after
  login.
- Multiple concurrent sessions are allowed and listed on the account page.
- Session responses include `id`, `createdAt`, `lastSeenAt`, `expiresAt`,
  `userAgent` and a `current` flag. Token hashes are never returned.

### API tokens

- Token format: `lrs_` followed by 32 random bytes encoded as base64url.
- SQLite stores the SHA-256 hash, a short display prefix, the name, scopes,
  timestamps and optional expiry. The full token is shown exactly once.
- Scopes:
  - `read` permits `GET` and `HEAD`;
  - `write` permits all methods and implies `read`.
- A token inherits the user's project access. There are no per-project tokens.
- Revocation sets `revoked_at`; revoked and expired tokens return `401`.
- `last_used_at` is updated at most once every five minutes.
- API tokens cannot create or revoke tokens, manage sessions, or call the
  `/users` endpoints. Those operations require a cookie session.
- The account page can create, list and revoke tokens. The create dialog offers
  “Read only” and “Read and write”.

### Login protection, CSRF and CORS

- `POST /auth/login` is rate-limited by client IP and normalized email. The
  default is 5 attempts per 15 minutes. The response is the standard API error
  envelope with `429 rate_limited` and `details.retryAfterSeconds`.
- Cookie-authenticated state-changing requests (`POST`, `PATCH`, `PUT`,
  `DELETE`) are rejected with `403 invalid_origin` when an `Origin` header is
  present and does not match:
  - the request's own origin;
  - `http://127.0.0.1:5173` or `http://localhost:5173` in development;
  - `LAYERS_UI_ORIGIN`.
- Missing `Origin` is allowed for non-browser clients. Bearer-token requests
  skip the origin check entirely.
- `@fastify/cors` uses exact allowed origins, `credentials: true`, and allows
  `Authorization`, `Content-Type` and `If-Match` request headers. The old
  wildcard localhost regex is removed.
- Auth responses set `Cache-Control: no-store`.

## 3. Database model

Add `server/db/migrations/002_auth.sql`.

```sql
CREATE TABLE users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  display_name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('super_admin', 'member')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  disabled_at TEXT
) STRICT;

CREATE UNIQUE INDEX idx_users_email ON users(email COLLATE NOCASE);
CREATE UNIQUE INDEX idx_users_single_super_admin
  ON users(role) WHERE role = 'super_admin';

CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  user_agent TEXT
) STRICT;

CREATE INDEX idx_sessions_user ON sessions(user_id);
CREATE INDEX idx_sessions_expires ON sessions(expires_at);

CREATE TABLE api_tokens (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  prefix TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  scopes TEXT NOT NULL,
  created_at TEXT NOT NULL,
  last_used_at TEXT,
  expires_at TEXT,
  revoked_at TEXT
) STRICT;

CREATE INDEX idx_api_tokens_user ON api_tokens(user_id);

CREATE TABLE user_state (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  active_project_id TEXT REFERENCES projects(id) ON DELETE SET NULL
) STRICT;

ALTER TABLE projects
  ADD COLUMN owner_id TEXT REFERENCES users(id) ON DELETE RESTRICT;
CREATE INDEX idx_projects_owner
  ON projects(owner_id, updated_at DESC);

ALTER TABLE activity_entries
  ADD COLUMN actor_user_id TEXT REFERENCES users(id) ON DELETE SET NULL;
CREATE INDEX idx_activity_actor ON activity_entries(actor_user_id);
```

### Ownership rules

- `projects.owner_id` is nullable only to make the migration possible. Every
  create, duplicate and import writes an owner. Startup claims every row where
  `owner_id IS NULL`.
- Project ids stay globally unique. Two users cannot own the same id.
- `ON DELETE RESTRICT` means a user with projects cannot be hard-deleted.
  Phase 6 does not expose user deletion.
- `activity_entries.actor_user_id` is nullable for imported and legacy events.
  New server-authored activity sets the current user.
- `user_state` replaces the global active-project key. `app_state` remains in
  the schema but stops being used after its value is migrated.
- `scopes` is stored as a JSON array string, for example `["read","write"]`.

### Migration and claim sequence

1. Migration 002 creates the auth tables and adds the two nullable columns.
2. Startup creates or synchronizes the super admin.
3. Startup selects all projects with `owner_id IS NULL`, assigns them to the
   super admin, and sets `actor_user_id` on their null-attributed activity.
4. Startup reads `app_state.active_project_id`; if it points at a project
   owned by the super admin, it writes that value to `user_state`, then deletes
   the legacy row.
5. Seeding runs only when the database still has no projects. Seeded projects
   and their activity belong to the super admin.
6. A fresh database therefore ends with one super admin, two seeded projects
   and a valid active project.

The claim is transactional. A failure leaves ownership unchanged and stops
startup rather than producing a partially claimed database.

## 4. API contract

Base path remains `/api/v1`. All endpoints are JSON unless noted.

### Endpoint summary

| Method | Path | Auth | Purpose |
| --- | --- | --- | --- |
| `GET` | `/health` | public | Liveness and database check |
| `GET` | `/openapi.json` | public | OpenAPI 3.1 document |
| `GET` | `/docs` | public | Interactive API reference |
| `POST` | `/auth/login` | public | Email/password sign-in; sets the session cookie |
| `POST` | `/auth/logout` | public | Clears the current session; idempotent |
| `GET` | `/auth/session` | session | Current user and cookie session |
| `GET` | `/me` | session or token | Current user, without session details |
| `GET` | `/auth/sessions` | session | List the current user's sessions |
| `DELETE` | `/auth/sessions/:id` | session | Revoke one of the current user's sessions |
| `DELETE` | `/auth/sessions` | session | Revoke all sessions except the current one |
| `GET` | `/me/tokens` | session | List the current user's API tokens |
| `POST` | `/me/tokens` | session | Create an API token; returns the secret once |
| `DELETE` | `/me/tokens/:id` | session | Revoke an API token |
| `GET` | `/users` | session + super admin | List users |
| `POST` | `/users` | session + super admin | Create a member user |
| `PATCH` | `/users/:id` | session + super admin | Enable or disable a user |
| `GET` | `/projects` | session or token | Projects owned by the current user |
| `POST` | `/projects` | session or token | Create an owned project |
| `GET` | `/projects/:id` | session or token | Owned project detail |
| `PATCH` | `/projects/:id` | session or token | Update owned project metadata |
| `DELETE` | `/projects/:id` | session or token | Delete an owned project |
| `POST` | `/projects/:id/duplicate` | session or token | Duplicate an owned project |
| `POST` | `/projects/:id/activate` | session or token | Set the current user's active project |
| `GET` | `/projects/:id/document` | session or token | Read an owned document |
| `PUT` | `/projects/:id/document` | session or token | Replace an owned document |
| `GET` | `/projects/:id/activity` | session or token | Read owned activity |
| `POST` | `/projects/:id/activity` | session or token | Append owned activity |
| `GET` | `/projects/:id/coverage` | session or token | Derived coverage for an owned project |
| `GET` | `/projects/:id/export` | session or token | Export an owned project |
| `POST` | `/projects/import` | session or token | Import a project owned by the current user |
| `POST` | `/test/reset` | test mode only | Reset the test database |

### Sign in

```http
POST /api/v1/auth/login
Content-Type: application/json

{
  "email": "ada@example.com",
  "password": "correct horse battery staple"
}
```

Success: `200`, `Set-Cookie: layers_session=...; HttpOnly; SameSite=Lax; Path=/`,
and:

```json
{
  "user": {
    "id": "usr_...",
    "email": "ada@example.com",
    "displayName": "Ada",
    "role": "member",
    "createdAt": "2026-11-15T10:00:00.000Z",
    "disabledAt": null
  },
  "session": {
    "id": "ses_...",
    "createdAt": "2026-11-15T10:05:00.000Z",
    "lastSeenAt": "2026-11-15T10:05:00.000Z",
    "expiresAt": "2026-12-15T10:05:00.000Z",
    "userAgent": "Mozilla/5.0 ..."
  }
}
```

Failures:

- `401 invalid_credentials` — unknown email or wrong password;
- `403 account_disabled` — correct password for a disabled account;
- `429 rate_limited` — too many attempts.

### Session

`GET /auth/session` is the browser-only session endpoint. It returns the same
`{ user, session }` shape and requires the session cookie; a bearer token gets
`403 forbidden` with a message that a cookie session is required. Without a
valid session it returns `401 unauthenticated`.

`GET /me` is the identity endpoint for either credential and returns
`{ "user": ... }` without session details. Agents use `/me`; the browser uses
`/auth/session`.

### Sign out

`POST /auth/logout` deletes the current session when present, clears the cookie
and returns `204`. It never reveals whether a session existed.

### Sessions

`GET /auth/sessions`:

```json
{
  "sessions": [
    {
      "id": "ses_...",
      "createdAt": "2026-11-15T10:05:00.000Z",
      "lastSeenAt": "2026-11-15T10:20:00.000Z",
      "expiresAt": "2026-12-15T10:20:00.000Z",
      "userAgent": "Mozilla/5.0 ...",
      "current": true
    }
  ]
}
```

`DELETE /auth/sessions/:id` returns `204`. Another user's session id returns
`404 not_found`. `DELETE /auth/sessions` revokes every session except the
current one and returns `204`.

### API tokens

`POST /me/tokens`:

```json
{
  "name": "Local coding agent",
  "scopes": ["read", "write"]
}
```

Response `201`:

```json
{
  "token": "lrs_...",
  "tokenInfo": {
    "id": "tok_...",
    "name": "Local coding agent",
    "prefix": "lrs_abcd",
    "scopes": ["read", "write"],
    "createdAt": "2026-11-15T10:30:00.000Z",
    "lastUsedAt": null,
    "expiresAt": null,
    "revokedAt": null
  }
}
```

`GET /me/tokens` returns `{ "tokens": [...] }` without the secret.
`DELETE /me/tokens/:id` sets `revokedAt` and returns `204`.

### User management

`GET /users` (super admin):

```json
{
  "users": [
    {
      "id": "usr_...",
      "email": "ada@example.com",
      "displayName": "Ada",
      "role": "member",
      "createdAt": "2026-11-15T10:00:00.000Z",
      "disabledAt": null
    }
  ]
}
```

`POST /users`:

```json
{
  "email": "ada@example.com",
  "password": "correct horse battery staple",
  "displayName": "Ada"
}
```

- `displayName` is optional and defaults to the email local part.
- The created user always has role `member`.
- A duplicate email returns `409 email_taken`.
- A weak or invalid password returns `422 validation_failed`.
- Returns `201` with `{ "user": ... }`; never returns the password.

`PATCH /users/:id` accepts only:

```json
{ "disabled": true }
```

- Disabling clears `disabled_at`'s null state, revokes every session and returns
  the updated user.
- Enabling clears `disabled_at`.
- The super admin cannot disable itself: `403 forbidden`.
- Email, display name, role and password cannot be changed through this
  endpoint.

### Existing endpoints

Every project endpoint now requires authentication and is scoped to the current
user:

- `GET /projects` filters by `owner_id` and reads the active project from
  `user_state`.
- `POST /projects` ignores any client owner field, sets the current user as
  owner and makes the new project that user's active project.
- `GET`, `PATCH`, `DELETE`, duplicate, document, activity, coverage and export
  return `404 not_found` for a project owned by another user.
- `POST /projects/import` assigns the importing user as owner and never shares
  the source owner.
- `POST /projects/:id/activate` writes `user_state`, not `app_state`.
- Activity appended through a document write or `POST /activity` records the
  acting user. Client payloads cannot set the actor.
- Export keeps the `layers-project` v3 shape and strips actor fields.
- ETag, `If-Match`, revision and conflict semantics are unchanged.

### OpenAPI security

Add two security schemes:

```yaml
components:
  securitySchemes:
    sessionCookie:
      type: apiKey
      in: cookie
      name: layers_session
    bearerAuth:
      type: http
      scheme: bearer
      bearerFormat: "lrs_..."
```

- Set a top-level `security` requiring either scheme.
- Override public operations with `security: []`.
- Add `401` and `403` responses to every protected operation.
- Document `POST /auth/login`, logout, session, sessions, tokens, users and the
  new error codes.
- Regenerate `server/api/generated.d.ts` with `npm run api:types`.
- Add contract tests that every route except the public allowlist declares
  security and every declared security scheme is valid.

### Error additions

| Status | Code | Meaning |
| --- | --- | --- |
| `401` | `unauthenticated` | No valid session or API token |
| `401` | `invalid_credentials` | Login email/password mismatch |
| `403` | `account_disabled` | Login succeeded but the account is disabled |
| `403` | `forbidden` | Authenticated but missing role or token scope |
| `403` | `invalid_origin` | Cookie-auth mutation with a disallowed origin |
| `409` | `email_taken` | User creation email already exists |
| `429` | `rate_limited` | Login rate limit exceeded |

All errors keep the phase 5 envelope. `rate_limited` includes
`details.retryAfterSeconds`; `forbidden` includes the missing role or scope when
useful.

## 5. Server implementation

Proposed module layout:

```text
server/auth/
  password.ts        Argon2id hash/verify with test-mode parameters
  tokens.ts          random session/API-token generation and SHA-256 hashing
  superAdmin.ts      ensureSuperAdmin synchronization
  middleware.ts      request authentication, origin check, scope checks
  guards.ts          requireSession, requireSuperAdmin, requireTokenWrite
server/db/
  authStore.ts       AuthStore interface and SqliteAuthStore
  bootstrap.ts       shared ensure/claim/migrate/prune/seed routine
server/api/routes/
  auth.ts            login, logout, session, sessions
  me.ts              API token management
  users.ts           super-admin user creation and disabling
server/api/schemas.ts  auth request/response schemas added
server/types/fastify.d.ts  request.auth augmentation
```

### Request authentication

`preHandler` hooks decorate `request.auth`:

```ts
type AuthContext =
  | { method: "session"; user: AuthUser; sessionId: string }
  | { method: "token"; user: AuthUser; tokenId: string; scopes: TokenScope[] };
```

- Bearer token is checked first when `Authorization: Bearer ...` is present.
- Otherwise the `layers_session` cookie is checked.
- A disabled user, expired session, revoked token or unknown token returns
  `401 unauthenticated`.
- Cookie-auth mutations run the origin check.
- Token requests check the method against scopes: `GET`/`HEAD` need `read`;
  mutations need `write`. A token with `write` implicitly has `read`.
- The hook updates session/token “last seen” timestamps with throttling.
- Never log `Authorization`, `Cookie`, passwords or full tokens. Fastify
  request logging must redact those headers.

### Authorization guards

- `requireSession` — cookie only; used by `/auth/session`, `/auth/sessions`,
  `/me/tokens` and `/users`.
- `requireSuperAdmin` — session plus `role === "super_admin"`.
- `requireAuth` — session or token; used by project/document/activity routes.
- Project ownership is enforced in the store, not only in the route. Every
  project-scoped store method takes `ownerId` as its first argument.
- A missing or foreign project returns `404 not_found`; do not return `403`,
  which would reveal that the id exists.

### Store interface changes

`ProjectStore` gains an owner argument on every project operation:

```ts
listProjects(ownerId: string): ProjectListResult;
getProject(ownerId: string, id: string): ProjectDetail | null;
createProject(ownerId: string, input: ProjectInput & { id?: string }): ProjectDetail;
updateProject(ownerId: string, id: string, patch: ProjectPatch, expectedRevision: number): ProjectDetail;
deleteProject(ownerId: string, id: string, expectedRevision: number): { activeProjectId: string | null };
duplicateProject(ownerId: string, id: string): ProjectDetail;
activateProject(ownerId: string, id: string): { activeProjectId: string | null };
getDocument(ownerId: string, id: string): DocumentSnapshot;
saveDocument(ownerId: string, id: string, input: SaveDocumentInput): SaveDocumentResult;
getActivity(ownerId: string, id: string, query: ActivityQuery): ActivityPage;
appendActivity(ownerId: string, id: string, input: AppendActivityInput): ActivityPage;
getCoverage(ownerId: string, id: string): CoverageResult;
exportProject(ownerId: string, id: string): ProjectExport;
importProject(ownerId: string, input: unknown): ImportProjectResult;
seedSamples(ownerId: string): void;
claimUnownedProjects(ownerId: string): number;
migrateLegacyActiveProject(ownerId: string): void;
getUserState(ownerId: string): { activeProjectId: string | null };
```

`AuthStore`:

```ts
getSuperAdmin(): UserRecord | null;
createSuperAdmin(input: { email: string; displayName: string; passwordHash: string }): UserRecord;
updateSuperAdmin(id: string, input: { email: string; displayName: string; passwordHash: string }): UserRecord;
getUser(id: string): UserRecord | null;
getUserByEmail(email: string): UserRecord | null;
listUsers(): UserRecord[];
createUser(input: { email: string; displayName: string; passwordHash: string }): UserRecord;
setUserDisabled(id: string, disabled: boolean): UserRecord;

createSession(input: { userId: string; tokenHash: string; expiresAt: string; userAgent: string | null }): SessionRecord;
findSessionByTokenHash(tokenHash: string): SessionRecord | null;
listSessions(userId: string): SessionRecord[];
touchSession(id: string, lastSeenAt: string, expiresAt: string): void;
deleteSession(id: string): void;
deleteUserSessions(userId: string): void;
deleteOtherSessions(userId: string, keepSessionId: string): void;
pruneExpiredSessions(now: string): number;

createApiToken(input: { userId: string; name: string; prefix: string; tokenHash: string; scopes: TokenScope[]; expiresAt: string | null }): ApiTokenRecord;
findApiTokenByHash(tokenHash: string): ApiTokenRecord | null;
listApiTokens(userId: string): ApiTokenRecord[];
touchApiToken(id: string, lastUsedAt: string): void;
revokeApiToken(userId: string, id: string): boolean;
pruneExpiredApiTokens(now: string): number;
```

Both stores take the same `DatabaseConnection` and injectable `now`/`newId`
functions for deterministic tests.

### Activity attribution

- Extend `ActivityEntry` with optional `actorUserId` and `actorName`.
- `normalizeActivity` reads optional actor fields and keeps them for API
  responses; imports ignore or clear them.
- `createActivityEntry` accepts an optional actor and is used by the server and
  the client reducer. Client-created activity does not set the actor; the
  server overwrites it from the authenticated request.
- `activity_entries` stores `actor_user_id`; reads join `users` for the display
  name or email used in `actorName`.
- Existing activity claimed with a legacy project is attributed to the super
  admin. Imported activity keeps `actor_user_id` null.
- `serializeProjectExport` maps events back to the phase 5 shape so export files
  do not gain actor fields.

### Test-only reset

`POST /test/reset` remains registered only when `LAYERS_TEST_MODE=1`. It now
runs the same `bootstrap` routine, so every reset recreates the test super
admin and sample ownership. It is not part of the public OpenAPI paths.

## 6. React client

### Auth client and provider

Add:

```text
src/api/auth.ts            login, logout, session, sessions, tokens, users calls
src/api/types.ts           auth/user/session/token response types
src/store/AuthProvider.tsx auth state, sign-in/out, account actions
src/app/AuthGate.tsx       loading/error/unauthenticated/authenticated gate
```

`src/api/client.ts` changes:

- send `credentials: "include"` on every request;
- treat `401` as `ApiError` and dispatch a `layers:unauthorized` event, except
  for `/auth/login` and `/auth/session`;
- expose `isUnauthenticated(error)`.

`AuthState` states:

```ts
type AuthState =
  | { status: "loading" }
  | { status: "unauthenticated"; reason?: "expired" | "signed-out" | "none" }
  | { status: "authenticated"; user: AuthUser; session: SessionInfo }
  | { status: "error"; message: string };
```

- Loads `GET /auth/session` on mount.
- Listens for `layers:unauthorized`, clears state and marks the session expired.
- Exposes `signIn`, `signOut`, `reload`, `revokeSession`, `revokeOtherSessions`,
  `createToken`, `revokeToken` and `createUser`.
- Never stores the session token in `localStorage` or JavaScript state; the
  cookie is the credential.

### Routing and gate

- Add routes `#/sign-in`, `#/account` and `#/users`.
- `AuthGate` decides:
  - loading → full-page loading state;
  - connection error → retry page;
  - unauthenticated → sign-in page, remembering the requested hash in memory;
  - authenticated → the existing workspace shell.
- After a successful sign-in, navigate to the remembered hash, or `#/projects`.
- Visiting `#/sign-in` while authenticated redirects to `#/projects`.
- `#/account` is available to every signed-in user.
- `#/users` is available only to the super admin; other roles get a
  `403`-style page or are redirected to projects.
- On sign-out or user change, unmount the workspace so no project data from the
  previous user remains in memory. Use `key={user.id}` on the authenticated
  shell.

### Sign-in page

- Email and password fields with proper labels and autocomplete:
  `username` and `current-password`.
- No “forgot password” and no “sign up” links.
- A short note: “Accounts are created by the workspace super admin.”
- Inline error for invalid credentials, disabled account and rate limiting.
- Submit disabled while pending.
- Accessible error summary with `role="alert"`.
- Focus moves to the email field on mount and to the error summary on failure.

### Account page

- Shows email, display name, role and account creation date.
- Lists active sessions with creation, last-seen, expiry, user agent and a
  **Revoke** button; marks the current session.
- **Sign out other sessions** action.
- Lists API tokens with name, prefix, scopes, creation, last use and status.
- **Create token** dialog: name, scope choice (Read only / Read and write), show
  the secret once after creation with a copy button and a warning that it cannot
  be shown again.
- **Revoke** token action with confirmation.
- No password section in this phase. A short note explains that password
  changes are not available.
- No account deletion.

### Users page (super admin)

- Create form: email, display name (optional), password, confirm password.
- Password minimum length is shown; confirm password is required because there
  is no password edit.
- Validation errors stay inline and keep the form values.
- User list: email, display name, role, created date, status.
- **Disable** / **Enable** actions; the super admin's own row cannot be disabled.
- No edit email, edit name, role change, password reset or delete controls.
- A note that accounts are created without sending email and that passwords
  cannot be recovered in this phase.

### Existing providers and components

- `ProjectsProvider` and `WorkspaceProvider` only mount inside the authenticated
  shell, so they can assume a user.
- `Topbar` gains a user menu with **Account**, **Users** (super admin only) and
  **Sign out**.
- `StorageBanner`/status banner adds a session-expired notice and keeps the
  existing retry behavior.
- `ErrorBoundary` offers reload, sign out and API docs; it must not expose
  credentials.
- The projects empty state for a new member explains that projects are private
  to their owner.
- No visual redesign is required beyond the new pages and menu.

### Accessibility

- Every form control has a label, description and error association.
- Login and user-creation errors are announced through `role="alert"`.
- Menus and dialogs are keyboard operable and trap focus as existing dialogs do.
- Password fields support password-manager autocomplete where appropriate.
- Axe covers sign-in, account, users, session-expired and empty-project states.

## 7. Authorization rules

| Action | Member / owner | Other member | Super admin |
| --- | --- | --- | --- |
| List projects | Own projects | Own projects | Own projects only |
| Read project/document/activity/coverage | Own project | `404` | `404` for another user's project |
| Create/update/delete/duplicate/import project | Own project | Own project | Own project only |
| Export project | Own project | `404` | Own project only |
| Set active project | Own project | Own project | Own project only |
| Create/revoke own API tokens | Yes, via cookie session | Yes, via cookie session | Yes, via cookie session |
| Create API tokens for another user | No | No | No |
| Manage own sessions | Yes | Yes | Yes |
| Manage another user's sessions | No | No | No; disabling the user revokes all sessions |
| List/create users | No, `403` | No, `403` | Yes |
| Disable/enable users | No | No | Yes, except self |
| Change roles, emails, passwords | No | No | No |
| Use bearer token for project work | Yes, within scopes | Yes, within scopes | Yes, within scopes |
| Use bearer token for users/sessions/tokens | No | No | No |

Rules:

- Project ownership is the only project-level authorization in this phase.
- The super admin does not bypass project ownership.
- Foreign project ids return `404`, not `403`.
- Disabled users cannot authenticate; existing sessions are deleted.
- A token's scope is checked on every request; missing scope returns `403
  forbidden`.
- `POST /test/reset` is available only in test mode and is intentionally
  unauthenticated.

## 8. Migration and data ownership

### Existing phase 5 database

1. Run migration 002. Auth tables appear; `owner_id` and `actor_user_id` are
   null for existing rows.
2. Read super-admin values from `.env`. Missing or invalid values stop startup.
3. Create or synchronize the single super admin.
4. In one transaction, claim every project with `owner_id IS NULL`, set the
   super admin as owner, and attribute that project's null activity to the super
   admin.
5. Move `app_state.active_project_id` into the super admin's `user_state` when
   the project exists and is now owned by the super admin. Delete the legacy
   row.
6. Do not seed because projects already exist.

No project, document or activity content is deleted. The only ownership change
is that all pre-auth data becomes the super admin's private data.

### Fresh database

1. Run migrations.
2. Create the super admin.
3. Seed the two sample projects when `LAYERS_SEED_SAMPLES=1`, owned by the super
   admin.
4. Set the super admin's active project to the first seeded project or the
   existing sort order fallback.
5. Member users created later start with an empty project list and no active
   project.

### Changing super-admin env values

- Email or display-name change: update the singleton row in place. Owned
  projects and activity remain attached.
- Password change: update the hash and revoke all super-admin sessions. The
  operator must sign in again.
- Email collision with a member: startup fails with a message naming the
  collision. Resolve it manually before restarting.
- `LAYERS_SEED_SAMPLES=0` disables sample seeding; it does not delete existing
  projects.

### Session and token cleanup

- Expired sessions are deleted on access, at startup and after login.
- Expired API tokens are rejected and pruned at startup.
- Revoked tokens stay in the table with `revoked_at` so the account page can
  show them until the user deletes the row. Hard deletion is optional and not
  needed in this phase.

## 9. Security considerations

- **Local threat model.** Authentication protects the API and separates local
  accounts, but any OS user who can read `data/layers.sqlite` can read the data
  directly. Document OS file permissions as part of the boundary. Database
  encryption is out of scope.
- **Super-admin secret.** Storing the password in `.env` is convenient but
  plaintext. `.env` is gitignored, file permissions should be restricted, and
  README must warn against committing or pasting it. The super admin can be
  rotated by editing `.env` and restarting.
- **Password storage.** Argon2id with OWASP parameters; test mode uses lower
  parameters only when `LAYERS_TEST_MODE=1`.
- **Session storage.** Only SHA-256 hashes of session tokens are stored; the
  cookie is `HttpOnly` and not readable by JavaScript.
- **Session fixation.** A new token is generated on every login; existing
  sessions are independent.
- **CSRF.** `SameSite=Lax` plus origin checks for cookie-auth mutations. Bearer
  tokens are not sent automatically by browsers, so they are not CSRF-prone.
- **CORS.** Exact origins with credentials; no wildcard. The Vite proxy keeps
  the default client same-origin.
- **Rate limiting.** Login is throttled per IP and email. Generic
  `invalid_credentials` avoids account enumeration on login.
- **Token handling.** Full token values are shown once, never logged and never
  returned by list endpoints. Tokens are revocable and optionally expiring.
- **Authorization.** Every store query is owner-scoped. Do not rely on the UI to
  hide projects; the server is the boundary. Contract tests assert 401 and IDOR
  behavior.
- **Logging.** Redact `Authorization`, `Cookie`, `Set-Cookie` and password
  fields. Do not log request bodies for auth routes.
- **Caching.** Auth responses are `no-store`. The API does not add conditional
  GET caching.
- **Remote exposure.** `LAYERS_ALLOW_REMOTE=1` still exists, but this phase does
  not provide TLS, secure proxy handling or remote deployment guidance. Keep
  the default loopback bind.

## 10. Tests and quality gate

### Unit tests (Vitest)

- Argon2 hash/verify round-trip, wrong password, rehash-on-login behavior and
  test-mode parameter selection.
- Session and API-token generation, hashing, prefix extraction and entropy
  assumptions.
- Session expiry, sliding-window throttle, revocation and pruning with an
  injected clock.
- API-token scope checks: read, write, write-implies-read, revoked, expired.
- Origin-check helper: same origin, configured origin, missing header, rejected
  header.
- Auth request schemas: email normalization, password length, display-name
  defaults, duplicate email shape.
- Activity normalization with optional actor fields.

### API integration tests (Vitest + Fastify `inject`)

Use a fresh in-memory database and the shared bootstrap per test file.

Authentication:

- bootstrap creates exactly one super admin and is idempotent;
- changing the env password updates the hash and revokes sessions;
- changing the env email updates the singleton in place; collision fails;
- login success, wrong password, unknown email, disabled account;
- rate limit returns `429` after the configured number of attempts;
- cookie attributes are present and `Secure` follows config;
- logout clears the cookie and is idempotent;
- session list, revoke one, revoke others, foreign session `404`;
- expired session returns `401` and is pruned;
- disabled user's sessions are revoked and cannot be used.

API tokens:

- create, list, use for a read request, use for a write request;
- read-only token rejects a mutation with `403`;
- revoked and expired tokens return `401`;
- token cannot call `/users`, `/auth/session`, `/auth/sessions` or
  `/me/tokens`; a bearer token can call `/me`;
- full token is returned once and never by list;
- last-used timestamp is updated with throttling.

Authorization / IDOR:

- every protected route returns `401` without credentials;
- public routes remain accessible;
- member cannot call `/users`;
- user B gets `404` for user A's project on list/get/patch/delete/duplicate/
  activate/document read/write/activity read/write/coverage/export;
- user B cannot import into user A's project or change ownership through any
  request body;
- super admin also gets `404` for a member's project;
- created and imported projects are owned by the caller;
- active project is per user;
- project list is filtered per user.

Users and activity:

- super admin can create a member, default display name, duplicate email,
  weak password and invalid email;
- super admin can disable/enable, cannot disable self;
- disabled user cannot log in;
- activity created by a member includes the correct actor;
- document-write activity includes the actor;
- imported activity has no actor;
- exported activity has no actor fields;
- legacy activity is attributed to the super admin when claimed.

Migration / bootstrap:

- a phase 5 database with projects and activity is claimed without data loss;
- legacy active project moves to `user_state`;
- a fresh database seeds samples owned by the super admin;
- `LAYERS_SEED_SAMPLES=0` skips seeding;
- existing ETag/conflict behavior still works after auth.

### Contract tests

- `server/api/openapi.yaml` is valid OpenAPI 3.1.
- Every non-public operation declares `sessionCookie` or `bearerAuth`.
- Public operations declare `security: []`.
- `401` and `403` responses are documented on protected operations.
- Login, user creation and token creation request/response examples validate
  against Zod.
- The generated `server/api/generated.d.ts` is current.
- Existing response validation continues to pass for authenticated requests.

### Playwright browser tests (Chromium)

Test isolation:

- one worker, dedicated `test-results/e2e.sqlite`;
- `LAYERS_TEST_MODE=1` supplies test super-admin defaults;
- `beforeEach` calls `POST /api/v1/test/reset`;
- helpers sign in through the UI or API request context;
- tests that need two users use two browser contexts.

Scenarios:

1. First load shows sign-in, not the workspace.
2. Wrong password shows a generic error; the form remains usable.
3. Super admin signs in and sees the seeded projects.
4. Session survives reload and a direct deep link.
5. Sign-out returns to sign-in and clears workspace data; back navigation does
   not reveal the previous project.
6. A protected deep link while signed out returns to the same hash after login.
7. Account page lists sessions and tokens; revoking another session works.
8. Create an API token, copy it once, reload and confirm the secret is no longer
   shown; revoke it.
9. Super admin creates a member with email/password/display name; the member can
   sign in; duplicate email and weak password errors are shown.
10. Disabled member cannot sign in; re-enabled member can.
11. Member A's project list does not include Member B's project; direct URL to
    B's project shows not-found; B can still edit their own project.
12. Super admin cannot open a member's project by URL.
13. Activity shows the acting user's display name and survives reload.
14. Project create, rename, duplicate, export/import, delete, chapters,
    criteria, verification, coverage and conflict handling still pass with
    authentication cookies.
15. Axe passes on sign-in, account, users, session-expired, empty-project and
    dialog states; all new controls are keyboard operable.
16. Production smoke signs in with the configured super admin and opens a
    project.

### Quality gate

```sh
npm run lint
npm run format:check
npm run typecheck
npm run test:unit
npm run test:api
npm run test:contract
npm run api:lint
npm run build
npm run test:e2e
npm run test:prod
```

CI gets no new secrets: test mode defaults cover unit, API, contract, E2E and
production smoke. Real `.env` values are required only for manual development
and `npm start` outside test mode.

## 11. Acceptance criteria

- [ ] `npm run dev` requires and loads `.env`; missing super-admin values fail
      with an actionable error.
- [ ] The super admin is created or synchronized on startup and is the only
      `super_admin` row.
- [ ] Sign-in, sign-out and session refresh work in the browser with an
      `HttpOnly` cookie.
- [ ] No session token, API token or password is stored in `localStorage` or
      readable by application JavaScript.
- [ ] The super admin can create member users with email, display name and
      password, and can disable/enable them.
- [ ] No self-registration, password recovery, password change or password
      reset endpoint exists.
- [ ] Every project endpoint requires a session or bearer token and is scoped to
      the project owner.
- [ ] Another user's project returns `404` for every project-scoped route,
      including the super admin.
- [ ] The project list and active project are per user.
- [ ] Existing phase 5 projects and activity are claimed by the super admin
      without data loss.
- [ ] Seeded samples belong to the super admin; new members start empty.
- [ ] Activity created after the phase records the acting user; exports remain
      actor-free and `layers-project` v3 compatible.
- [ ] Bearer tokens support read-only and read-write scopes, show the secret
      once, can be revoked, and cannot manage users, sessions or tokens.
- [ ] Login is rate-limited and CSRF/origin protections apply to cookie-auth
      mutations.
- [ ] OpenAPI documents both security schemes, public endpoints, 401/403
      responses and the new error codes.
- [ ] The full quality gate is green, including IDOR, auth, contract and
      two-user browser tests.
- [ ] README, `docs/api.md`, `AGENTS_template.md` and `phases/phase-ideas.md`
      describe the new auth boundary and token workflow.

## 12. Risks and mitigations

| Risk | Mitigation |
| --- | --- |
| Plaintext super-admin password in `.env` | Gitignore `.env`, restrict file permissions, document rotation, never log it, keep loopback as the default |
| No password recovery or change | Document the limitation prominently; disabling plus recreating an account is the only recovery; add password management in a later phase |
| Legacy projects become invisible after migration | Transactional claim assigns every unowned project to the super admin; test with a phase 5 fixture |
| Auth refactor breaks every API test | Add helpers first, then convert route tests mechanically; contract tests assert no protected route is missed |
| IDOR through a missed owner filter | Every store method takes `ownerId`; a matrix test covers every project route; foreign ids return 404 |
| Super-admin email collision | Fail startup with a clear message instead of silently creating a second admin |
| Session writes on every request | Throttle `last_seen_at`/`expires_at` updates to once per hour |
| Argon2 slows the test suite | Reduced test-mode parameters; production parameters are not configurable from the environment |
| Cookie auth breaks when `VITE_API_URL` is absolute | Allow `LAYERS_UI_ORIGIN` with credentials; keep the Vite proxy as the default; document the requirement |
| CSRF or CORS misconfiguration | Exact origins, `SameSite=Lax`, origin checks on cookie mutations, bearer bypass, dedicated tests |
| Rate limiting breaks E2E | High test-mode default; dedicated rate-limit test with an explicit low limit |
| Activity export gains PII | Export serializer strips actor fields; test round-trip and file shape |
| `projects.owner_id` stays nullable | All writes set it, startup claims legacy rows, and a later migration can enforce `NOT NULL` |
| Selected chapter remains project-wide | Acceptable while projects are private; revisit per-user selection with P-02 |
| Tokens leak through logs or UI | Never log auth headers or secrets; show the token once; list only prefixes; revoke support |
| Remote exposure without TLS | Local-only scope; keep `LAYERS_ALLOW_REMOTE` off by default and document the limitation |

## 13. Out of scope

- Project sharing, memberships, invitations and owner/editor/viewer roles
  (P-02).
- Project ownership transfer or reassignment.
- Password change, forgot-password, password reset, email verification and
  email delivery.
- OAuth, OIDC, passkeys, 2FA and external identity providers.
- User deletion, account deletion and data export of personal data.
- Per-user selected chapter.
- A durable audit log beyond actor attribution (P-04).
- Cross-device sync, cloud backup and collaboration (P-03/P-02).
- Remote hosting, TLS, reverse proxies, secure-cookie proxy handling and
  deployment guidance.
- Postgres support and database selection (P-13).
- Search, filtering, pagination and bulk user operations.
- Rate limiting beyond login.
- Security headers/CSP beyond what already exists.
- Mobile-native clients.

## 14. Delivery sequence

1. **Config and env.** Add `dotenv`, `.env.example`, `.gitignore`, the new
   config fields, test-mode defaults and fail-fast validation.
2. **Schema.** Add migration 002, auth store interfaces and the shared bootstrap
   routine; verify claim behavior against a phase 5 fixture.
3. **Auth core.** Password hashing, token generation, sessions, cookies,
   request authentication, origin checks and rate limiting.
4. **Auth API.** Login/logout/session/sessions, API tokens, users; Zod schemas,
   OpenAPI security and generated types.
5. **Project scoping.** Thread `ownerId` through the project store and routes;
   move active project to `user_state`; add activity attribution.
6. **Client auth.** Auth client/provider/gate, sign-in, account and users pages,
   user menu, 401 handling and workspace reset on user change.
7. **Test migration.** Update helpers and every API test; add auth, IDOR,
   contract and migration tests.
8. **Browser tests.** Add auth/account/users/two-user/axe scenarios; update
   existing project tests for sign-in.
9. **Docs and quality gate.** Update README, `docs/api.md`, `AGENTS_template.md`
   and `phase-ideas.md`; run the full gate; record delivery notes.

## 15. Files

New:

```text
.env.example
server/auth/password.ts
server/auth/tokens.ts
server/auth/superAdmin.ts
server/auth/middleware.ts
server/auth/guards.ts
server/db/authStore.ts
server/db/bootstrap.ts
server/db/migrations/002_auth.sql
server/api/routes/auth.ts
server/api/routes/me.ts
server/api/routes/users.ts
server/types/fastify.d.ts
src/api/auth.ts
src/store/AuthProvider.tsx
src/app/AuthGate.tsx
src/components/SignInPage.tsx
src/components/AccountPage.tsx
src/components/UsersPage.tsx
src/components/UserMenu.tsx
src/components/SessionList.tsx
src/components/ApiTokenList.tsx
tests/unit/auth.test.ts
tests/unit/authTokens.test.ts
tests/api/auth.test.ts
tests/api/authorization.test.ts
tests/api/users.test.ts
tests/api/tokens.test.ts
tests/auth.spec.js
tests/users.spec.js
tests/authorization.spec.js
```

Modified:

```text
package.json                         dependencies, env-aware scripts
.gitignore                           .env
server/config.ts                     super-admin, session, cookie, CORS, rate-limit config
server/index.ts                      bootstrap sequence and auth store wiring
server/app.ts                        cookie/CORS/rate-limit plugins, auth routes and hooks
server/db/store.ts                   owner-scoped methods, user state, activity actor
server/db/reset.ts                   full bootstrap and seeded ownership
server/api/schemas.ts                auth/user/token schemas
server/api/errors.ts                 new error codes
server/api/openapi.yaml              security schemes, auth endpoints, 401/403
server/api/generated.d.ts            regenerated
server/api/routes/projects.ts        auth hooks and owner scoping
server/api/routes/document.ts        auth hooks and owner scoping
server/api/routes/activity.ts        auth hooks, owner scoping and actor
server/api/routes/coverage.ts        auth hooks and owner scoping
server/api/routes/exports.ts         auth hooks and owner scoping
server/api/routes/test.ts            bootstrap-based reset
src/api/client.ts                    credentials and 401 handling
src/api/types.ts                     auth/user/session/token types
src/api/projects.ts                  auth-aware request behavior
src/api/workspace.ts                 auth-aware request behavior
src/hooks/useRoute.ts                sign-in, account and users routes
src/app/App.tsx                      auth gate and user-scoped shell
src/app/WorkspaceShell.tsx           user menu and sign-out wiring
src/app/ErrorBoundary.tsx            auth-aware recovery
src/components/Topbar.tsx            user menu
src/components/StorageBanner.tsx     session-expired notice
src/styles.css                       auth/account/users states
README.md                            .env setup, auth, tokens, boundaries
docs/api.md                          login, cookie and bearer examples
AGENTS_template.md                   bearer-token workflow and auth boundaries
phases/phase-ideas.md                remove P-01 after delivery and note P-02/P-04
.github/workflows/ci.yml             only if test env wiring needs it
```

No existing source file is expected to be removed. The phase 5 localStorage
removal remains in effect.

## 16. Delivery notes

Implemented on 2026-11-15.

### Runtime and configuration

- `.env` is loaded with `dotenv`; `.env.example` is committed and `.env` is
  ignored. `LAYERS_SUPER_ADMIN_EMAIL`, `LAYERS_SUPER_ADMIN_PASSWORD` and
  `LAYERS_SUPER_ADMIN_NAME` are required outside test mode. Test mode supplies
  `super@example.test` / `test-super-admin-password` / `Super Admin`.
- Startup order is migrations → super-admin synchronization → legacy project
  claim → legacy active-project migration → session/token pruning → sample
  seeding. The shared routine is `server/db/bootstrap.ts`, used by the server,
  `db:reset`, test helpers and the test-only reset endpoint.
- The super admin is a singleton `users` row with role `super_admin`. Changing
  its `.env` password updates the hash and revokes its sessions; changing the
  email or display name updates the same row and preserves owned projects.
- Runtime dependencies added: `@fastify/cookie`, `@fastify/rate-limit`,
  `@node-rs/argon2` and `dotenv`. The server build externalizes
  `@node-rs/argon2` and `better-sqlite3`.

### Database and ownership

- Migration `server/db/migrations/002_auth.sql` adds `users`, `sessions`,
  `api_tokens`, `user_state`, `projects.owner_id` and
  `activity_entries.actor_user_id`.
- `projects.owner_id` is nullable for migration only. Startup claims every
  unowned project and its unattributed activity to the super admin. A later
  migration can rebuild the column as `NOT NULL`.
- The legacy `app_state.active_project_id` value is copied to the super admin's
  `user_state` and the legacy key is deleted. `app_state` remains unused.
- Seeded sample projects belong to the super admin. New members start with an
  empty catalog.
- `ProjectStore` methods now take `ownerId`; foreign project reads and writes
  return `404` before `If-Match` parsing.
- Activity reads join `users` for `actorName`. New activity records
  `actor_user_id`; imported activity is stored without an actor; exports strip
  actor fields and remain `layers-project` v3.

### Authentication and API

- Passwords use Argon2id via `@node-rs/argon2` (19 MiB, 2 passes, 1 lane;
  reduced parameters in test mode).
- Browser sessions use the `layers_session` cookie: `HttpOnly`,
  `SameSite=Lax`, `Path=/`, optional `Secure`, 30-day sliding lifetime. Only
  SHA-256 token hashes are stored. Session timestamps are touched at most once
  per hour.
- API tokens use `lrs_...`, are stored hashed, support `read`/`write` scopes,
  optional expiry, revocation and a 20-active-token limit. Token management and
  user/session management require a cookie session.
- Login is rate-limited per IP and normalized email. The rate-limit error uses
  the standard API envelope.
- Cookie-authenticated mutations check the `Origin` header when present. CORS
  uses exact configured origins with credentials.
- Public routes: `/health`, `/openapi.json`, `/docs`, `/auth/login`,
  `/auth/logout`. `/auth/session`, `/auth/sessions`, `/me/tokens` and `/users`
  are cookie-only. `/me` and all project routes accept a cookie or bearer token.
- OpenAPI documents `sessionCookie` and `bearerAuth`, public overrides, auth
  endpoints, 401/403 responses and the new error codes. Generated types were
  regenerated.

### Client

- `AuthProvider` loads `/auth/session`, handles 401 expiry events and exposes
  sign-in/out, session and token actions, and super-admin user actions.
- `AuthGate` renders sign-in, account, users or the workspace. The requested
  hash is preserved naturally, so deep links return after sign-in.
- Added `#/sign-in`, `#/account` and `#/users`; the topbar has a user menu.
- The account page lists sessions and API tokens, creates tokens with a one-time
  secret, and revokes sessions/tokens. There is no password UI.
- The users page creates members with email, display name, password and password
  confirmation, and disables/enables accounts. The super admin cannot disable
  itself.
- The workspace unmounts on sign-out/user change, clearing prior project data.

### Explicit deviations from the plan

- Password rehash-on-login for old Argon2 parameters was not added; new hashes
  always use the current parameters.
- Session cleanup runs at startup and on access, not after every login.
- `LAYERS_UI_ORIGIN` adds one extra origin rather than a comma-separated list.
- The planned `server/auth/guards.ts` was not needed; `middleware.ts` exports
  the three Fastify guards.
- The planned separate `server/api/schemas/auth.ts` was folded into
  `server/api/schemas.ts`.

### Verification

Run on 2026-11-15:

```sh
npm run lint          # clean
npm run format:check  # clean
npm run typecheck     # clean
npm run test:unit     # 78 passed (9 files)
npm run test:api      # 40 passed (7 files)
npm run test:contract # 8 passed
npm run api:lint      # valid, warnings only
npm run build         # succeeded
npm run test:e2e      # 42 passed (Chromium)
npm run test:prod     # 1 passed (production preview)
```

Production build (gzip): app 22.2 kB, vendor 50.6 kB, React 69.0 kB, icons
2.5 kB, projects page 2.0 kB, coverage 1.9 kB, activity 0.7 kB, CSS 8.9 kB.
The auth pages are included in the main app chunk.

## 17. Backlog relationship

- Phase 6 completes **P-01 — Authentication and user accounts**. P-01 was
  removed from `phases/phase-ideas.md`.
- **P-02 — Collaboration, permissions and shared workspaces** remains next. It
  still needs project memberships, roles, invitations, per-user selected chapter
  and a conflict-resolution model.
- **P-04 — Durable server-side activity audit log** is advanced by actor
  attribution, but retention, audit queries and a larger history remain.
- **P-03 — Cross-device sync** now has identity, but still needs a remote
  deployment and sync protocol.
- **P-15 — MCP** can use the bearer-token workflow delivered here instead of an
  unauthenticated local API.
- New deferred ideas were added for **P-17 password change/recovery**, **P-18
  project transfer/user deletion** and **P-19 per-user selected chapter**.
