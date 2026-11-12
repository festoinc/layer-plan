# Phase 5 — Local API and SQLite persistence

Status: delivered  
Date: 2026-11-11

## Goal

Replace browser-local persistence with a real local HTTP API backed by SQLite,
and make that API the single source of truth for both the React application and
AI agents.

The phase delivers:

- a TypeScript + Fastify API at `http://127.0.0.1:3001/api/v1`;
- a SQLite database for projects, documents, activity, settings and UI state;
- a document-oriented API with optimistic concurrency;
- OpenAPI 3.1 documentation and runtime validation;
- a React client that loads and saves everything through the API;
- one command that starts the API, database and UI together;
- removal of all `localStorage` persistence.

The phase keeps the phase 1–4 product model. The storage implementation, failure
modes, cross-tab behaviour and some recovery behaviour change because the source
of truth moves from the browser to a local server.

## Locked decisions

| Topic | Decision |
| --- | --- |
| Phase scope | HTTP API + database + React integration |
| Consumers | React app and AI agents |
| API style | Document-oriented project document with catalog endpoints |
| Runtime | TypeScript + Fastify |
| Database | SQLite only in this phase; Postgres remains a future option |
| Deployment | Local only, bound to loopback; no remote hosting |
| Authentication | None; single-user local usage |
| Source of truth | API + SQLite; `localStorage` is removed |
| Existing local data | Not migrated; current data is disposable mock data |
| Concurrency | Optimistic concurrency with revisions and `If-Match` |
| API ownership | Catalog, document, activity, guidelines, selection and coverage |
| Contract | OpenAPI 3.1 source document, Zod validation, generated types |
| Export format | Existing `layers-project` version 3 |
| Quality gate | Current gate plus API unit, integration, contract and Playwright tests |
| Developer startup | One command starts API, SQLite and UI |
| Documentation | Served OpenAPI docs plus README/API usage notes |

### Derived choices to review

These follow from the answers above but were not stated explicitly.

- **Sample data is seeded on an empty database.** The two phase 4 sample projects
  remain the first-run experience. `LAYERS_SEED_SAMPLES=0` disables seeding.
- **Metadata and document have separate revisions.** Renaming a project does not
  invalidate a document write, and autosaving a document does not invalidate an
  open project settings dialog.
- **`If-Match` mismatch returns `412 Precondition Failed`** with error code
  `revision_conflict`, not `409`. The earlier idea of using `409` is replaced by
  the standard HTTP status. Clients branch on the error code, not the status.
- **Activity is client-authored but server-timestamped.** The reducer keeps
  producing activity messages and IDs. A document write may carry new activity
  entries; the server assigns their canonical timestamps, deduplicates by
  `(project_id, id)` and caps the project history at 100 entries. Server-side
  project operations log their own activity.
- **Export and import are API-backed.** The browser still downloads and uploads
  files, but `GET /projects/:id/export` and `POST /projects/import` own the
  serialization. This is a deviation from the earlier “stays client-side”
  default, which no longer works once `localStorage` is gone.
- **The active project is server-side UI state.** `GET /projects` returns
  `{ projects, activeProjectId }`; `POST /projects/:id/activate` changes it.
- **Coverage is available from the API.** The React coverage page may continue
  to derive coverage from the loaded document, but
  `GET /projects/:id/coverage` gives AI agents the same result without
  reimplementing the rules.
- **Cross-tab live synchronization is replaced by refresh-on-focus and conflict
  handling.** There is no WebSocket/SSE channel in this phase. A second tab sees
  external changes when it regains focus if it has no pending writes; otherwise
  a save conflict is surfaced explicitly.
- **Old `localStorage` keys are not migrated or cleaned up.** The code stops
  reading and writing them. Browsers may keep stale `layers:*` keys, but they are
  unused and safe to delete manually.
- **The domain schema stays version 6.** API database migrations are versioned
  separately. The `layers-project` export format stays version 3.

## 1. Runtime, repository layout and scripts

Phase 5 keeps the single-package repository and adds a `server/` tree. The
server imports the pure domain modules from `src/domain/` so validation,
normalization, project summaries and coverage rules have one implementation.

```text
server/
  index.ts                     bootstrap config, DB, Fastify, listen, shutdown
  app.ts                       Fastify instance, plugins, error handling, docs
  config.ts                    PORT, HOST, LAYERS_DB_PATH, seed/test flags
  api/
    openapi.yaml               normative OpenAPI 3.1 contract
    generated.d.ts             generated from openapi.yaml
    schemas.ts                 Zod request/response schemas
    errors.ts                  ApiError, error envelope, mapZodError
    etag.ts                    parse/format quoted integer ETags
    routes/
      health.ts
      projects.ts
      document.ts
      activity.ts
      coverage.ts
      export.ts
      import.ts
  db/
    client.ts                  better-sqlite3 connection, pragmas, close
    migrate.ts                 exported migration runner
    migrate-cli.ts             CLI wrapper for npm run db:migrate
    migrations/001_init.sql
    store.ts                   ProjectStore interface used by routes
    sqliteStore.ts             SQLite implementation
    seed.ts                    sample projects from src/data
    reset.ts                   reset/seed CLI helpers
  test/
    helpers.ts                 temporary DB + Fastify app helpers
```

### Dependencies

Runtime:

- `fastify`
- `@fastify/cors`
- `@fastify/static` (serves the built UI from `dist/` in `npm start`)
- `better-sqlite3`
- `zod`
- `@scalar/fastify-api-reference` (serves the OpenAPI document)

Development:

- `tsx` — run and watch the server
- `tsup` — bundle the server for `npm start`
- `concurrently` — start API and Vite together
- `cross-env` — portable environment variables in scripts
- `@types/better-sqlite3`, `@types/node`
- `openapi-typescript` — generated response/request types
- `@redocly/cli` — OpenAPI lint
- `ajv` and an OpenAPI response validator for contract tests

Exact package versions are chosen during implementation; they are not part of
the product contract.

### Scripts

```json
{
  "dev": "concurrently -k -n api,ui -c cyan,magenta \"npm:dev:api\" \"npm:dev:ui\"",
  "dev:api": "tsx watch server/index.ts",
  "dev:ui": "vite --host 127.0.0.1",
  "dev:e2e": "cross-env LAYERS_DB_PATH=test-results/e2e.sqlite LAYERS_SEED_SAMPLES=1 npm run db:reset && cross-env LAYERS_DB_PATH=test-results/e2e.sqlite LAYERS_SEED_SAMPLES=1 concurrently -k -n api,ui \"npm:dev:api\" \"npm:dev:ui\"",
  "db:migrate": "tsx server/db/migrate-cli.ts",
  "db:reset": "tsx server/db/reset.ts",
  "api:spec": "tsx server/api/export-spec.ts",
  "api:types": "openapi-typescript server/api/openapi.yaml -o server/api/generated.d.ts",
  "api:lint": "redocly lint server/api/openapi.yaml",
  "build": "npm run build:ui && npm run build:api",
  "build:ui": "vite build",
  "build:api": "tsup server/index.ts --format esm --platform node --out-dir dist-server --clean --external better-sqlite3",
  "start": "node dist-server/index.js",
  "typecheck": "tsc --noEmit && tsc -p tsconfig.server.json --noEmit",
  "test:unit": "vitest run tests/unit",
  "test:api": "vitest run tests/api",
  "test:contract": "vitest run tests/contract",
  "test": "npm run test:unit && npm run test:api && npm run test:contract && playwright test",
  "test:e2e": "playwright test",
  "test:prod": "npm run build && cross-env LAYERS_DB_PATH=test-results/prod.sqlite LAYERS_SEED_SAMPLES=1 npm run db:reset && cross-env LAYERS_DB_PATH=test-results/prod.sqlite LAYERS_SEED_SAMPLES=1 E2E_TARGET=production playwright test tests/smoke.spec.js"
}
```

`npm run dev` is the requested one-command development startup. `npm start`
serves the built UI and API together on port 3001 after `npm run build`.

### Ports and configuration

| Variable | Default | Meaning |
| --- | --- | --- |
| `HOST` | `127.0.0.1` | API bind address |
| `PORT` | `3001` | API port |
| `LAYERS_DB_PATH` | `data/layers.sqlite` | SQLite database file |
| `LAYERS_SEED_SAMPLES` | `1` | Seed sample projects when the DB is empty |
| `LAYERS_TEST_MODE` | `0` | Enable test-only reset endpoint |
| `LAYERS_ALLOW_REMOTE` | `0` | Allow a non-loopback bind |
| `VITE_API_URL` | `/api/v1` | Browser API base URL |

The server refuses to bind to a non-loopback address unless
`LAYERS_ALLOW_REMOTE=1`. Phase 5 has no authentication, so loopback is the
security boundary.

`vite.config.js` proxies `/api` to `http://127.0.0.1:3001` in development. In
`npm start`, Fastify serves the built `dist/` UI and the API from the same
origin, so no CORS is needed. Development CORS allows only the local Vite
origins.

`data/` is added to `.gitignore`.

## 2. Database model

Phase 5 uses SQLite through `better-sqlite3`. All SQL stays under
`server/db/`; routes depend on a `ProjectStore` interface. A later phase can add
a Postgres adapter or switch to a dialect-aware query builder without changing
the API or React client. No Postgres driver, selection UI or connection string
is added now.

### Tables

```sql
CREATE TABLE schema_migrations (
  version INTEGER PRIMARY KEY,
  applied_at TEXT NOT NULL
) STRICT;

CREATE TABLE projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  initials TEXT NOT NULL,
  color TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  test_guidelines TEXT NOT NULL DEFAULT '',
  chapter_count INTEGER NOT NULL DEFAULT 0,
  criterion_count INTEGER NOT NULL DEFAULT 0,
  checked_count INTEGER NOT NULL DEFAULT 0,
  metadata_revision INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
) STRICT;

CREATE TABLE project_documents (
  project_id TEXT PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
  revision INTEGER NOT NULL DEFAULT 1,
  chapters_json TEXT NOT NULL,
  selected_id TEXT,
  updated_at TEXT NOT NULL
) STRICT;

CREATE TABLE activity_entries (
  sequence INTEGER PRIMARY KEY AUTOINCREMENT,
  id TEXT NOT NULL,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  message TEXT NOT NULL,
  chapter_id TEXT,
  chapter_name TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (project_id, id)
) STRICT;

CREATE INDEX idx_activity_project_sequence
  ON activity_entries(project_id, sequence DESC);

CREATE TABLE app_state (
  key TEXT PRIMARY KEY,
  value TEXT
) STRICT;
```

`app_state` stores `active_project_id`. If it points at a deleted or missing
project, reads fall back to the first project by the existing `sortProjects`
order and repair the state.

### Connection settings

- `PRAGMA journal_mode = WAL`
- `PRAGMA foreign_keys = ON`
- `PRAGMA busy_timeout = 5000`
- Migrations run synchronously before the server listens.
- The database directory is created if missing.
- The connection closes on `SIGINT`/`SIGTERM` and on Fastify shutdown.

### Persistence rules

- `projects` owns metadata, guidelines, stats and the metadata revision.
- `project_documents` owns the normalized chapter document, selected chapter
  and the document revision.
- `activity_entries` is append-only. There is no update or delete endpoint.
- Activity retention stays at the phase 4 limit of 100 entries per project. This
  is not yet the durable audit log described by P-04.
- A document write updates `project_documents`, project stats and project
  `updated_at` in one transaction.
- Metadata or guideline writes update `projects.metadata_revision`,
  `updated_at` and add an activity entry in one transaction.
- Activity-only appends do not change the document revision or reorder the
  project list.
- Deleting a project cascades to its document and activity.

### Revisions and ETags

| Resource | Revision | ETag | Precondition |
| --- | --- | --- | --- |
| Project metadata/settings | `projects.metadata_revision` | `"4"` | `PATCH`/`DELETE` use `If-Match` |
| Project document | `project_documents.revision` | `"12"` | `PUT /document` uses `If-Match` |

Revisions are positive integers and increment on each successful write that
changes the resource. ETags are quoted decimal strings, for example
`ETag: "12"`.

`If-Match` is required for `PATCH /projects/:id`, `DELETE /projects/:id` and
`PUT /projects/:id/document`. A missing header returns `428 Precondition
Required`; a stale header returns `412 Precondition Failed` with
`error.code = "revision_conflict"` and the current revision in `details`.

The API does not implement conditional `GET`/`304` caching in this phase. ETags
exist for write preconditions only.

### Validation and repair

- Zod validates request shape before any database work.
- `normalizeDocument` and `normalizeActivity` remain the canonical repair
  routines and are reused by the server.
- Document writes are strict: if normalization reports issues, the API returns
  `422 validation_failed` with the issue list instead of silently repairing.
  The React client always sends a valid normalized document.
- Import is intentionally lenient: repairs are applied and returned in the
  response `issues` array, matching phase 4 import behavior.
- Stored JSON is normalized again on read. A corrupt stored document is a
  server error (`500 stored_data_invalid`), not a silent reset. The server never
  overwrites unreadable data automatically.
- API limits:

| Field | Limit |
| --- | --- |
| Project name | 80 characters |
| Project initials | 2 characters |
| Project description | 280 characters |
| Test guidelines | 8,000 characters |
| Chapter title | 200 characters |
| Chapter description | 100,000 characters |
| Criterion text | 20,000 characters |
| Chapters per project | 5,000 |
| Criteria per chapter | 500 |
| Activity message | 1,000 characters |
| Activity chapter name | 200 characters |
| Request body | 10 MB |

The UI already enforces the project, description and guidelines limits. The
remaining limits are API safety bounds; exceeding them is a client error, not a
silent truncation.

## 3. API contract

Base path: `/api/v1`. All requests and responses are JSON unless noted.

### Endpoint summary

| Method | Path | Purpose | Concurrency |
| --- | --- | --- | --- |
| `GET` | `/health` | Liveness and database check | — |
| `GET` | `/openapi.json` | OpenAPI 3.1 document | — |
| `GET` | `/docs` | Interactive API documentation | — |
| `GET` | `/projects` | Project catalog and active project | — |
| `POST` | `/projects` | Create a project | — |
| `GET` | `/projects/:id` | Project detail, guidelines and revisions | — |
| `PATCH` | `/projects/:id` | Update metadata or guidelines | `If-Match` metadata |
| `DELETE` | `/projects/:id` | Delete a project | `If-Match` metadata |
| `POST` | `/projects/:id/duplicate` | Duplicate a project | — |
| `POST` | `/projects/:id/activate` | Set the active project | — |
| `GET` | `/projects/:id/document` | Read the project document | — |
| `PUT` | `/projects/:id/document` | Replace the project document | `If-Match` document |
| `GET` | `/projects/:id/activity` | Read activity history | — |
| `POST` | `/projects/:id/activity` | Append activity | — |
| `GET` | `/projects/:id/coverage` | Derived verification coverage | — |
| `GET` | `/projects/:id/export` | Download a `layers-project` v3 file | — |
| `POST` | `/projects/import` | Import a `layers-project` file | — |

### Catalog

`GET /projects`

```json
{
  "projects": [
    {
      "id": "website",
      "name": "Website project",
      "initials": "W",
      "color": "indigo",
      "description": "Marketing site and account flows.",
      "createdAt": "2026-11-11T18:00:00.000Z",
      "updatedAt": "2026-11-11T18:10:00.000Z",
      "chapterCount": 7,
      "criterionCount": 12,
      "checkedCount": 3
    }
  ],
  "activeProjectId": "website"
}
```

Projects are sorted with the existing `sortProjects` rule: active first, then
most recently updated, then name. The list intentionally excludes test
guidelines and revisions so it stays compact.

`POST /projects`

```json
{
  "id": "optional-client-id",
  "name": "Internal tools",
  "initials": "IT",
  "color": "amber",
  "description": "Internal specifications.",
  "testGuidelines": "Run the internal suite."
}
```

- `id` is optional. If provided, it must match the project id pattern and be
  unique. Otherwise the server generates one.
- A new project starts with one root chapter titled `Overview`.
- The server logs `Created project` in the new project’s activity.
- The new project becomes active.
- Returns `201` with the project detail shape below.

`GET /projects/:id`

```json
{
  "id": "website",
  "name": "Website project",
  "initials": "W",
  "color": "indigo",
  "description": "Marketing site and account flows.",
  "createdAt": "2026-11-11T18:00:00.000Z",
  "updatedAt": "2026-11-11T18:10:00.000Z",
  "chapterCount": 7,
  "criterionCount": 12,
  "checkedCount": 3,
  "testGuidelines": "Run npm test before verifying.",
  "metadataRevision": 3,
  "documentRevision": 12
}
```

Response includes `ETag: "3"` for the metadata revision.

`PATCH /projects/:id` accepts any subset of `name`, `initials`, `color`,
`description` and `testGuidelines`. An empty name is rejected. The server
normalizes values with the existing project helpers and records activity:

- renamed project → `Renamed project to "<name>"`;
- guidelines changed → `Updated test guidelines`;
- otherwise → `Updated project settings`.

Returns the updated project detail and a new metadata ETag. The document
revision is unchanged.

`DELETE /projects/:id` requires `If-Match` for the metadata revision and returns
`{ "activeProjectId": "mobile" }`. If the deleted project was active, the first
remaining project becomes active; an empty catalog returns `null`. Project
deletion is not logged because the activity is deleted with the project.

`POST /projects/:id/duplicate` creates a new project with:

- the same document and selected chapter;
- the same test guidelines;
- a name based on the existing `uniqueProjectName` rule;
- a single activity entry `Duplicated from <source name>`;
- the duplicate as the new active project.

Returns `201` with the new project detail.

`POST /projects/:id/activate` returns `{ "activeProjectId": "<id>" }`.
Unknown ids return `404`.

### Document

`GET /projects/:id/document`

```json
{
  "schemaVersion": 6,
  "projectId": "website",
  "revision": 12,
  "updatedAt": "2026-11-11T18:10:00.000Z",
  "chapters": {
    "byId": {},
    "rootIds": []
  },
  "selectedId": "password-reset"
}
```

Response includes `ETag: "12"`. Activity is not part of this resource; it has
its own endpoint.

`PUT /projects/:id/document` requires `If-Match`. Request:

```json
{
  "chapters": {
    "byId": {},
    "rootIds": []
  },
  "selectedId": "password-reset",
  "activity": [
    {
      "id": "event-uuid",
      "message": "Created subchapter",
      "chapterId": "chapter-uuid",
      "chapterName": "Reset email"
    }
  ]
}
```

- `activity` is optional and contains only **new** entries. It exists so one
  client action can persist the document and its activity atomically.
- The server ignores client timestamps and assigns `created_at`.
- Existing activity ids are ignored, making retries idempotent for activity.
- `selectedId` must be `null` or an id present in the submitted document.
- The document is validated and normalized, then written with its stats.
- The document revision increments only when chapters or `selectedId` change.

Response:

```json
{
  "schemaVersion": 6,
  "projectId": "website",
  "revision": 13,
  "updatedAt": "2026-11-11T18:11:00.000Z",
  "chapters": {
    "byId": {},
    "rootIds": []
  },
  "selectedId": "password-reset",
  "stats": {
    "chapterCount": 7,
    "criterionCount": 12,
    "checkedCount": 3
  },
  "activity": []
}
```

`activity` in the PUT response is the latest 100 entries in newest-first order,
so the client can replace its optimistic activity with canonical server
timestamps without a second request. `GET /document` remains activity-free.

### Activity

`GET /projects/:id/activity?limit=100&before=<sequence>`

```json
{
  "events": [
    {
      "id": "event-uuid",
      "message": "Completed criterion: Email is verified",
      "chapterId": "chapter-uuid",
      "chapterName": "Login",
      "time": "2026-11-11T18:11:00.000Z"
    }
  ],
  "nextBefore": null
}
```

- Newest first.
- `limit` defaults to 100 and is capped at 100.
- `nextBefore` is `null` because the current retention limit is 100. The
  parameter is reserved for a future larger audit history.

`POST /projects/:id/activity`

```json
{
  "message": "Reviewed AI verification instructions",
  "chapterId": "chapter-uuid",
  "chapterName": "Permission prompts"
}
```

Returns `201` with `{ "events": [...] }` containing the latest history. This is
the endpoint AI agents use for explicit notes. `chapterId` may be `null` or omit
the chapter name; the server writes `Untitled chapter` when no name is given.

Activity remains append-only. There is no endpoint to edit or delete an event.

### Coverage

`GET /projects/:id/coverage`

```json
{
  "summary": {
    "total": 5,
    "automated": 2,
    "human": 2,
    "ai": 1,
    "incompleteAuto": 0,
    "percent": 40
  },
  "rows": [
    {
      "chapterId": "login",
      "chapterTitle": "Login",
      "chapterPath": "Website project specification › Account › Login",
      "mode": "auto",
      "command": "npm test login:test-ok",
      "automated": true,
      "incompleteAuto": false,
      "criterionCount": 2,
      "checkedCount": 1
    }
  ],
  "testGuidelines": "Run npm test before verifying."
}
```

The endpoint uses `summarizeVerification` and `getCoverageRows` from
`src/domain/verification.ts`. The React coverage page may keep deriving the same
values from the loaded document; the endpoint exists so agents and scripts do
not need to duplicate the rules.

### Export and import

`GET /projects/:id/export` returns the existing `layers-project` version 3 JSON
with `Content-Disposition: attachment`. It contains project metadata, document,
activity, selected chapter and test guidelines. The server serializes it with
the existing `serializeProjectExport` helper.

`POST /projects/import` accepts the contents of a `layers-project` v3 file as
the JSON body. It behaves like phase 4:

- always creates a new project, never overwrites;
- assigns a new project id;
- appends `(imported)` when the name collides;
- normalizes older formats and returns repair issues;
- copies imported activity, preserving its original timestamps, then appends
  `Imported project "<name>"` with a server timestamp;
- makes the imported project active;
- returns `201` with `{ "project": { ... }, "issues": [] }`.

The browser still provides the file download/upload controls. It fetches the
export body and posts the selected file text; it does not build the export from
local state.

### Errors

All error responses use one envelope:

```json
{
  "error": {
    "code": "revision_conflict",
    "message": "The document changed since it was loaded.",
    "details": {
      "currentRevision": 13
    }
  }
}
```

| Status | Code | Meaning |
| --- | --- | --- |
| `400` | `invalid_json` | Body is not valid JSON |
| `404` | `not_found` | Project or route does not exist |
| `409` | `project_limit` | The 9,999 project limit was reached |
| `412` | `revision_conflict` | `If-Match` is stale |
| `413` | `payload_too_large` | Request body exceeds the limit |
| `422` | `validation_failed` | Zod or document normalization failed |
| `428` | `precondition_required` | A required `If-Match` header is missing |
| `500` | `stored_data_invalid` | Stored data cannot be normalized |
| `500` | `internal_error` | Unhandled server error |
| `503` | `database_unavailable` | SQLite cannot be opened or queried |

Validation details use `{ "path": "chapters.byId.x.title", "message": "..." }`.

### OpenAPI and documentation

`server/api/openapi.yaml` is the normative contract. It includes every endpoint,
request/response schema, error envelope, status code and example.

- `server/api/schemas.ts` implements the same shapes with Zod for runtime
  validation.
- `npm run api:types` generates `server/api/generated.d.ts` from the OpenAPI
  file. CI fails if the generated file is stale.
- `npm run api:lint` validates the OpenAPI document with Redocly.
- `GET /api/v1/openapi.json` serves the same contract as JSON.
- `GET /api/v1/docs` serves interactive documentation with Scalar.
- `docs/api.md` contains short curl examples and the common agent flows:
  list projects, read a document, save a document with `If-Match`, append
  activity, read coverage, export and import.

## 4. React client integration

The UI must stop assuming synchronous local storage. The API becomes the only
data source; there is no mock or local fallback.

### New client layer

Add:

```text
src/api/client.ts          fetch wrapper, ApiError, ETag helpers, timeout
src/api/projects.ts        catalog and project detail calls
src/api/workspace.ts       document and activity calls
src/store/apiTypes.ts      API response types shared by providers
```

`ApiError` carries `status`, `code`, `message` and `details`. The client
normalizes network failures into `ApiUnavailableError` with a user-facing
message and a retry action.

API base URL: `import.meta.env.VITE_API_URL ?? "/api/v1"`. Vite proxies `/api`
in development.

### ProjectsProvider

`ProjectsProvider` becomes asynchronous:

- loads `GET /projects` on mount;
- exposes `state: "loading" | "ready" | "error"`, `projects`,
  `activeProjectId`, `notices`, `status` and `reload`;
- exposes async actions: `createProject`, `updateProject`, `duplicateProject`,
  `deleteProject`, `importProject`, `exportProject`, `setActiveProject`;
- returns `Promise<CatalogResult<T>>` so dialogs can show server validation
  errors and remain open on failure;
- caches project detail (`testGuidelines`, revisions) per project and exposes
  `loadProjectDetail(id)` for the coverage page and project settings;
- refreshes the catalog after mutations and when the window regains focus.

`App` renders a full-page loading state while the catalog is loading, and a
retryable connection error page if it cannot load. The error page links to
`/api/v1/docs` and offers **Retry**.

`ProjectDialog` and the delete dialog accept async submit handlers, disable
their primary button while a request is in flight and keep server error
messages visible. The current sync `{ ok, issues }` contract is replaced.
Opening project settings or deletion loads `GET /projects/:id` first so the
dialog has the metadata ETag for its `PATCH` or `DELETE`.

### WorkspaceProvider

Replace the localStorage `ProjectRepository` with:

```ts
export interface WorkspaceRepository {
  load(): Promise<{
    workspace: Workspace;
    revision: number;
    notices: ApiNotice[];
  }>;
  save(
    workspace: Workspace,
    options: {
      immediate?: boolean;
      newActivity?: ActivityInput[];
    },
  ): Promise<{
    revision: number;
    activity: ActivityEntry[];
    stats: ProjectStats;
  }>;
  flush(options?: { keepalive?: boolean }): Promise<void>;
  status(): WorkspaceStatus;
  onStatusChange(listener: (status: WorkspaceStatus) => void): () => void;
  dispose(): void;
}
```

Status states: `loading`, `saved`, `pending`, `error`, `conflict`.

Loading:

- `GET /projects/:id/document` and `GET /projects/:id/activity` run in parallel.
- The document response provides chapters and `selectedId`; the activity
  response provides events.
- The provider renders a project-level loading skeleton until both resolve.
- If the document request succeeds but activity fails, the workspace still opens
  and the activity page shows a retryable error. Document load failure blocks
  editing.

Saving:

- Keep the 250 ms debounce for text edits and immediate writes for structural
  actions, matching the current reducer’s `IMMEDIATE_ACTIONS`.
- Allow one document write in flight per project per tab. If state changes while
  a request is running, keep only the newest snapshot in the queue and send it
  after the current response. A `412` clears the queue and enters the conflict
  state.
- Send `If-Match: "<revision>"` with the latest acknowledged document revision.
- Compute `newActivity` from reducer events whose ids have not been acknowledged
  by the server. Send only those entries.
- On success, store the returned revision and dispatch a new
  `replaceActivity` reducer action with the canonical latest 100 events.
- On network failure, keep the pending workspace in memory, set status `error`
  and show **Retry saving**. Editing may continue in memory while the banner is
  visible.
- On `412`, stop autosaving and set status `conflict`.

Conflict UI:

- A conflict banner explains that the project changed in another tab or client.
- **Reload latest** fetches the current document and replaces local state.
- **Overwrite server** fetches the current revision, then writes the local
  document with the new `If-Match`. This is explicitly destructive and is
  confirmed.
- Editing is blocked while the conflict banner is active, so the user cannot
  keep typing into a document that will be replaced.

Lifecycle:

- `pagehide`/`beforeunload` attempt a best-effort flush with
  `fetch(..., { keepalive: true })`. Structural edits are already immediate; a
  final debounced text edit may still be lost if the browser refuses a keepalive
  request.
- On `focus`/`visibilitychange`, if there are no pending or in-flight writes,
  fetch the document revision. If it differs, refresh the activity and adopt the
  server document with a notice. If there are pending writes, do nothing; the
  next save detects the conflict.
- The `storage` event, localStorage probe, backup keys, quota handling and
  corrupt-payload recovery are removed.

### Components and state changes

- `StorageBanner` becomes `StatusBanner` with:
  - saving/saved status;
  - retryable API errors;
  - conflict actions;
  - import/export notices.
  It keeps `role="status"` / `role="alert"` and the existing accessible names
  where possible.
- `Topbar` and `Sidebar` import the new status type instead of the persistence
  type.
- `ErrorBoundary` no longer offers a raw localStorage backup. It offers reload,
  open API docs and a copyable error message.
- `TestCoverageView` loads/updates guidelines asynchronously. It keeps deriving
  coverage from the workspace document for immediate rendering. A failed
  guideline save shows an inline error and keeps the textarea value.
- `ActivityView` continues to read `state.events`; those events now come from
  the API and have server timestamps.
- `ProjectsView`, `ProjectSwitcher`, `ProjectCard`, dialogs and `App` receive
  async handlers. No visual redesign is required.

Move `projectExportFilename` out of the deleted `catalogRepository.ts` into a
small shared helper before removing the old module. Keep the existing filename
format.

### Files removed or replaced

Removed:

```text
src/store/persistence.ts
src/store/catalogRepository.ts
tests/persistence.spec.js
tests/unit/persistence.test.js
tests/unit/catalogRepository.test.js
```

Replaced by the API client, API repository and server tests. No component may
import `localStorage` directly; a lint rule or test assertion enforces that
after the refactor.

## 5. Activity semantics

The existing reducer stays authoritative for in-session activity messages. Phase
5 changes only where activity is stored and how it is timestamped.

- Client activity ids remain UUIDs generated by `createId()`.
- Client event times are ignored on write. Server time is canonical.
- New entries are deduplicated by `(project_id, id)`; retries do not duplicate
  history, and imported activity from another project cannot collide with local
  ids.
- A project keeps the newest 100 entries, matching `MAX_ACTIVITY_ENTRIES`.
- Project metadata operations are logged by the server:
  - `Created project`
  - `Renamed project to "<name>"`
  - `Updated test guidelines`
  - `Updated project settings`
  - `Duplicated from <name>`
  - `Imported project "<name>"`
- Document operations keep the phase 4 messages:
  - created chapter/subchapter;
  - deleted chapter;
  - added/removed/completed/unchecked criterion;
  - verification mode changes.
- Text-only edits still do not create activity, matching phase 4.
- Imported historical activity keeps its original timestamps; the import entry
  uses server time.
- Activity links to deleted chapters still render as plain text, because the
  UI checks the current document before rendering a button.

## 6. Persistence removal and reset

Phase 5 intentionally does not migrate browser data.

- All reads and writes of `layers:projects:v5`, `layers:project:*:*`,
  `layers:backup:*` and older keys are removed.
- The v5 reset/banner/corrupt-data/backup/key-namespace logic is removed.
- `readRawBackup`, `downloadJson` from the old persistence module and the
  storage probe are removed. Export/import remains available through the API.
- Old browser keys are left untouched by the app. They are unreachable dead
  data.
- The server database is the new persistence boundary. `npm run db:reset`
  deletes it, runs migrations and reseeds samples.

This is a deliberate data loss for current mock projects and is approved. No
production data exists in the current prototype.

## 7. Quality gate and tests

### Unit tests (Vitest, Node)

Keep the pure domain tests:

- chapters, criteria, projects, schema normalization, activity and verification.

Add server helper unit tests:

- quoted integer ETag parsing and formatting;
- `ApiError` status/code mapping and Zod error shaping;
- request schema fixtures for every request body type.

Add client-side unit tests:

- `ApiError` mapping, JSON parsing, timeouts and retry behavior;
- ETag header construction;
- catalog response sorting and active-project handling;
- workspace save queue, activity diffing and conflict state transitions with a
  mocked `fetch`.

Remove tests that assert localStorage keys, corruption backups, quota failures
or storage events.

### API integration tests (Vitest + Fastify `inject`)

Use a fresh SQLite database per test file (temporary file or `:memory:`), run
migrations, and build the Fastify app without listening.

Cover:

- migrations are idempotent and create all tables;
- seed creates the two sample projects and activity;
- project list sorting, active project, create/update/delete/duplicate;
- project limits, validation errors, metadata ETags;
- document read/write, normalization, stats, selected chapter, revisions;
- `If-Match` missing → `428`, stale → `412`, current → success;
- activity append, dedupe by id, retention at 100, ordering, timestamps;
- guidelines update and activity message;
- coverage summary and rows;
- export/import round-trip, older format import and name collision;
- deleting a project cascades document and activity;
- unknown project and invalid JSON errors;
- database failure mapping to `503` where practical.

### Contract tests (Vitest + Ajv/OpenAPI validator)

- Load `server/api/openapi.yaml` and validate that the document is a valid
  OpenAPI 3.1 spec.
- For every documented success and error response, run the route and validate
  the actual response against the OpenAPI schema.
- Validate request examples from the spec against the Zod schemas.
- Assert every route is present in the spec and every documented route exists.
- Run `npm run api:lint` and check `generated.d.ts` is current.

### Browser tests (Playwright, Chromium)

The suite runs against the real API and SQLite database.

Test isolation:

- Set `workers: 1` for the API-backed E2E suite.
- Use a dedicated `test-results/e2e.sqlite` database.
- Reset and reseed the database before each test through a test-only endpoint
  registered only when `LAYERS_TEST_MODE=1`:
  `POST /api/v1/test/reset`.
- Playwright’s `beforeEach` calls the reset endpoint through its request
  context, then navigates.
- The reset endpoint is not registered in normal development or production
  starts.

Scenarios:

1. First load seeds the sample projects and opens the website project.
2. Create, rename, duplicate, import, export and delete projects through the UI
   and API.
3. Chapter and subchapter creation, editing, deletion and criterion flows still
   work.
4. Verification modes, coverage counting and guidelines editing still work.
5. Reloading the browser preserves data through the API.
6. Editing in one page and reloading another shows the server-backed data.
7. Two pages editing the same document: the second save shows a conflict banner;
   **Reload latest** adopts the server state; **Overwrite server** is explicit.
8. Stopping/being unable to reach the API shows a retryable error and no data is
   silently persisted locally.
9. `localStorage` is never written: assert no `layers:*` keys are created after a
   full editing session.
10. Export downloads a `layers-project` v3 file; import uploads it and creates a
    new project.
11. Activity entries show server timestamps and survive reload.
12. Axe passes on the loading, error, conflict, dialog, coverage and editor
    states; the conflict banner is keyboard operable.
13. Routing, focus management, project isolation and production smoke continue
    to pass.

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

`npm run typecheck` covers both client and server. `npm run build` builds the UI
and bundles the server. CI runs the API and contract suites before Playwright and
starts the full stack for E2E. `playwright.config.js` uses `npm run dev:e2e` in
the development suite and `npm start` when `E2E_TARGET=production`; both use
`reuseExistingServer: false` so the test-mode server and database are used. The
production smoke run resets a temporary database before starting the server.

## 8. Acceptance criteria

- [ ] `npm run dev` starts Fastify, SQLite migrations and Vite; the UI loads
      exclusively from the API.
- [ ] `npm start` serves the built UI and API together on one local port.
- [ ] The API exposes every capability the UI needs: catalog, document,
      activity, guidelines, selected chapter, coverage, export and import.
- [ ] An AI agent can complete the documented flows using only the API and
      `server/api/openapi.yaml`; no mock data or browser state is required.
- [ ] OpenAPI docs are served at `/api/v1/docs` and the JSON contract at
      `/api/v1/openapi.json`.
- [ ] A fresh database is migrated automatically and seeded with the two sample
      projects unless seeding is disabled.
- [ ] Project metadata and document writes use optimistic concurrency; stale
      `If-Match` returns `412 revision_conflict`.
- [ ] The UI handles loading, API failure, retry and document conflict states
      accessibly.
- [ ] Documents, selected chapter, activity, guidelines and active project
      survive browser reloads and are shared by all tabs through the server.
- [ ] `localStorage` is not read or written anywhere in `src`.
- [ ] The old localStorage tests, storage banners and raw-backup recovery are
      removed and replaced by API-backed tests.
- [ ] Activity is append-only, server-timestamped, deduplicated by
      `(project_id, id)` and capped at 100 entries.
- [ ] `layers-project` v3 export/import round-trips through the API, including
      activity and guidelines.
- [ ] The coverage endpoint returns the same summary and rows as the UI’s
      domain computation.
- [ ] The full quality gate is green and README/API docs describe the new
      startup, database and API boundaries.

## 9. Risks and mitigations

| Risk | Mitigation |
| --- | --- |
| The async client refactor touches most providers and dialogs | Introduce the API client behind the existing repository/provider interfaces first; convert UI handlers to async in a separate step; keep visual changes out of the phase |
| Optimistic conflicts lose local edits | Never auto-overwrite on `412`; show explicit **Reload latest** and **Overwrite server** actions; serialize writes per project in one tab |
| Removing localStorage removes the only backup | Export is API-backed and tested; `npm run db:reset` is explicit; no production data exists |
| OpenAPI and Zod drift | Contract tests validate live responses against the spec; generated types are checked in CI |
| Shared test database causes flaky browser tests | Serial workers, a dedicated test DB and a test-only reset endpoint |
| Sample seeding makes tests non-deterministic | Seeding is explicit, reset per test, and disabled for API integration tests unless asserted |
| SQLite locks under concurrent writes | WAL, `busy_timeout`, short transactions and one writer per project operation |
| Save-on-unload is unreliable over HTTP | Structural edits are immediate; final flush uses keepalive; document the best-effort limitation |
| Server build cannot resolve `src/domain` extensionless imports | Bundle the server with `tsup`, keeping the domain imports resolved at build time |
| Future Postgres work leaks through routes | Routes depend on a `ProjectStore` interface; all SQL stays under `server/db` |
| Local API is unauthenticated | Bind to loopback by default, refuse remote binds unless explicitly allowed, keep CORS local-only |
| Coverage logic diverges between UI and API | Both use the same `src/domain/verification.ts` helpers |

## 10. Deliberate behaviour changes

- The app no longer works without the local API. There is no offline or
  in-browser fallback.
- Selected chapter and active project are server state, so they are shared by
  tabs and survive browser storage clearing.
- Activity timestamps are server-generated; imported historical timestamps are
  preserved.
- Cross-tab live sync becomes refresh-on-focus plus explicit conflict handling.
- Corrupt local storage, quota failures, backup keys and automatic reset banners
  are removed. Server storage errors are surfaced as API errors instead.
- Project metadata and document writes use separate revisions.
- Export/import moves behind the API while keeping the same file format and
  browser controls.
- The first run seeds sample projects from the server, not from browser code.
- There is no authentication, multi-user isolation or remote deployment.

## 11. Out of scope

- Accounts, sign-in, sessions, permissions and user identity (remaining P-01).
- Collaboration, presence, shared workspaces and conflict-free editing (P-02).
- Postgres support or a database selection UI.
- Remote deployment, TLS, reverse proxies and hosted infrastructure.
- API keys, rate limiting, quotas and public API exposure.
- Offline-first support, service workers and installable PWA behaviour.
- WebSocket/SSE live updates.
- Running Auto-test commands, recording results or ingesting test reports
  (P-06).
- A durable audit log beyond the 100-entry activity history (P-04).
- Search, filtering, pagination or bulk operations for projects and documents.
- Migrating existing `localStorage` data.
- Mobile-native clients.
- Undo/history for document writes.

## 12. Delivery sequence

1. **Server skeleton.** Add Fastify, config, SQLite connection, migrations,
   health endpoint and shutdown handling.
2. **Store layer.** Implement `ProjectStore`/SQLite store for projects,
   documents, activity and app state; reuse domain normalization and summaries.
3. **Catalog API.** Implement list/create/detail/update/delete/duplicate/
   activate, metadata ETags, seeding and API tests.
4. **Document and activity API.** Implement document read/write, activity append
   and retention, document ETags and conflict tests.
5. **Derived and file APIs.** Add coverage, export and import; wire the OpenAPI
   document, Zod schemas, generated types and docs.
6. **Client API layer.** Add the fetch client, typed calls, API repositories and
   async provider states.
7. **UI integration.** Convert dialogs, project pages, workspace loading,
   status/conflict banners, coverage guidelines and error boundary; remove all
   localStorage code.
8. **Test migration.** Replace persistence/catalog unit tests with API tests;
   update Playwright for API-backed isolation, conflict handling and no
   localStorage; add contract tests.
9. **Tooling and docs.** Add scripts, Vite proxy, server build, test reset
   endpoint, CI steps, `.gitignore`, README and `docs/api.md`.
10. **Quality gate.** Run the full gate, fix accessibility and production smoke
    issues, and record the results in the delivered phase notes.

## 13. Files

New:

```text
server/index.ts
server/app.ts
server/config.ts
server/api/openapi.yaml
server/api/generated.d.ts
server/api/schemas.ts
server/api/errors.ts
server/api/etag.ts
server/api/export-spec.ts
server/api/routes/health.ts
server/api/routes/projects.ts
server/api/routes/document.ts
server/api/routes/activity.ts
server/api/routes/coverage.ts
server/api/routes/export.ts
server/api/routes/import.ts
server/db/client.ts
server/db/migrate.ts
server/db/migrate-cli.ts
server/db/migrations/001_init.sql
server/db/store.ts
server/db/sqliteStore.ts
server/db/seed.ts
server/db/reset.ts
server/test/helpers.ts
src/api/client.ts
src/api/projects.ts
src/api/workspace.ts
src/store/apiTypes.ts
tests/api/*.test.ts
tests/contract/*.test.ts
docs/api.md
```

Modified:

```text
package.json                         scripts and dependencies
vite.config.js                       dev proxy and test include patterns
tsconfig.json                        server include or server-specific config
playwright.config.js                 API-backed web server, serial workers
.github/workflows/ci.yml             API, contract and full-stack E2E
src/main.tsx                         provider wiring only
src/app/App.tsx                      async catalog loading, retry state
src/app/WorkspaceShell.tsx           async actions, conflict/status wiring
src/app/ErrorBoundary.tsx            API-aware recovery screen
src/store/ProjectsProvider.tsx       async catalog/detail state
src/store/WorkspaceProvider.tsx      async document, queue, ETags, conflict UI
src/store/workspaceReducer.ts        replaceActivity action
src/components/ProjectDialog.tsx     async submit and pending state
src/components/DeleteProjectDialog.tsx async delete
src/components/ProjectsView.tsx      async callbacks
src/components/TestCoverageView.tsx  async guidelines
src/components/StorageBanner.tsx     rename/reshape into StatusBanner
src/components/Topbar.tsx            status type
src/components/Sidebar.tsx           status type
src/styles.css                       status/conflict/loading states
README.md                            API + SQLite startup and boundaries
.gitignore                           data/
```

Removed:

```text
src/store/persistence.ts
src/store/catalogRepository.ts
tests/persistence.spec.js
tests/unit/persistence.test.js
tests/unit/catalogRepository.test.js
```

## 14. Delivery notes

Implemented on 2026-11-11.

- Fastify API and SQLite database are in `server/`. The initial migration is
  `server/db/migrations/001_init.sql`; migrations run at startup. The store
  lives in `server/db/store.ts` (`SqliteStore`) rather than separate
  `store.ts`/`sqliteStore.ts` files.
- Sample projects are seeded by `SqliteStore.seedSamples()` from `src/data.ts`.
  There is no separate `server/db/seed.ts`.
- The API implements the planned catalog, document, activity, coverage,
  export/import, health and documentation routes. The test-only reset route is
  registered only with `LAYERS_TEST_MODE=1` and is not part of the public
  OpenAPI paths.
- `server/api/openapi.yaml` is the checked-in contract; Redocly lint passes.
  `server/api/generated.d.ts` is generated by `openapi-typescript` and formatted
  by Prettier. Scalar serves the reference at `/api/v1/docs`.
- The React client now uses `src/api/client.ts`, `src/api/projects.ts`,
  `src/api/workspace.ts` and `src/api/types.ts`. `src/store/persistence.ts` and
  `src/store/catalogRepository.ts` were deleted. No application code reads or
  writes `localStorage`.
- `ProjectsProvider` and `WorkspaceProvider` are asynchronous. The workspace
  provider serializes one document write at a time, tracks acknowledged activity
  by id, and supports **Reload latest** and **Overwrite server** after a `412`.
- The status banner component kept the `StorageBanner` name to avoid an
  unrelated component rename, but it now renders API status, errors and conflict
  actions. It no longer offers raw storage backups.
- `projectExportFilename` remains a small client helper in
  `ProjectsProvider`; the server has its own filename helper for the export
  `Content-Disposition`.
- Test helpers live in `tests/api/helpers.ts`, not `server/test/helpers.ts`.
  API tests use in-memory SQLite; Playwright uses a dedicated
  `test-results/e2e.sqlite` database, one worker and the guarded reset endpoint.
- `src/store/apiTypes.ts` from the plan was implemented as `src/api/types.ts`.

### Verification

Run on 2026-11-11:

```sh
npm run lint          # clean
npm run format:check  # clean
npm run typecheck     # clean
npm run test:unit     # 67 passed (7 files)
npm run test:api      # 11 passed (2 files)
npm run test:contract # 5 passed
npm run api:lint      # valid, warnings only
npm run build         # succeeded
npm run test:e2e      # 34 passed (Chromium)
npm run test:prod     # 1 passed (production preview)
```

Production build (gzip): app 18.5 kB, React 69.0 kB, Markdown vendor 50.6 kB,
icons 1.9 kB, projects page 2.0 kB (lazy), coverage 1.9 kB (lazy), activity
0.7 kB (lazy), CSS 7.8 kB.

## 15. Backlog relationship

Phase 5 delivers the backend/API portion of P-01. Authentication, accounts and
permissions remain in P-01 and should be split into a later auth phase before
implementation. P-02 (collaboration), P-03 (cross-device sync) and P-04 (durable
audit log) still depend on that identity work.

P-04 is partially advanced because activity now lives on the server, but it is
still capped at 100 entries and has no retention policy, attribution or audit
query surface.

P-06 (report-based coverage) remains out of scope; phase 5 only exposes the
existing declaration-based coverage through the API.

After phase 5 is delivered, update `phase-ideas.md` to mark the backend portion
of P-01 as delivered and split the remaining auth/accounts work into its own
stable idea.
