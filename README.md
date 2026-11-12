# Layers

A local workspace for project specifications. Create projects, and inside each
project create chapters and nested subchapters. Each chapter has an editable
Markdown description, verification rules and a success-criteria checklist.

Everything is stored in a local Fastify API backed by SQLite. There is no
authentication, no cloud service and no browser `localStorage` persistence. The
React UI is one client of the API; local AI agents can use the same HTTP
contract.

## Run

Node 22 or newer is required.

```sh
npm install
npm run dev
```

`npm run dev` starts the API at `http://127.0.0.1:3001` and the Vite UI at
`http://127.0.0.1:5173`. The SQLite database defaults to `data/layers.sqlite`
and is migrated automatically. The first run seeds the **Website project** and
**Mobile app** samples.

To run the built UI and API together from one process:

```sh
npm run build
npm start
```

Open `http://127.0.0.1:3001`.

Useful database and API commands:

```sh
npm run db:migrate   # apply pending migrations
npm run db:reset     # delete and reseed the local database
npm run api:spec     # write server/api/openapi.json
npm run api:types    # regenerate types from the OpenAPI document
npm run api:lint     # lint the OpenAPI document
```

The interactive API reference is at
`http://127.0.0.1:3001/api/v1/docs`. The normative contract is
[`server/api/openapi.yaml`](server/api/openapi.yaml); short agent-oriented curl
examples are in [`docs/api.md`](docs/api.md).

### Environment

| Variable              | Default              | Meaning                                 |
| --------------------- | -------------------- | --------------------------------------- |
| `HOST`                | `127.0.0.1`          | API bind address                        |
| `PORT`                | `3001`               | API port                                |
| `LAYERS_DB_PATH`      | `data/layers.sqlite` | SQLite database file                    |
| `LAYERS_SEED_SAMPLES` | `1`                  | Seed samples when the database is empty |
| `LAYERS_TEST_MODE`    | `0`                  | Enable the test-only reset endpoint     |
| `LAYERS_ALLOW_REMOTE` | `0`                  | Allow a non-loopback bind               |
| `VITE_API_URL`        | `/api/v1`            | Browser API base URL                    |

The server refuses a non-loopback bind unless `LAYERS_ALLOW_REMOTE=1`. The API
has no authentication, so loopback is the security boundary.

## Usage

The sidebar project switcher opens the project menu. **All projects** opens the
projects page where you can create, rename, duplicate, export, import and delete
projects. Each project keeps its own chapters, verification rules, activity,
selected chapter, test coverage and test guidelines.

Inside a project, use the **+** next to a chapter to add a subchapter, or **New
chapter** to create a top-level chapter. Click a chapter to edit its title,
description, and checklist. Descriptions and success criteria support
GitHub-flavored Markdown. Text displays formatted by default; double-click a
description or checklist item to edit its Markdown, or focus it and press
Enter/F2. Press Escape or Ctrl/Cmd+Enter to finish editing.

Adding a success criterion also creates a subchapter under the current chapter
unless **Final level** is checked. Its title comes from the first line of the
criterion. Manually created subchapters do not add checklist items. Press Enter
to add a criterion and Shift+Enter for a new line. Changes save automatically to
the local API.

### Verification and coverage

Subchapters get a **Verification Rules** section between Description and Success
criteria. Each subchapter has one rule for that page, regardless of how many
criteria it contains. The rule chooses one mode:

- **Auto-test** — one full command such as `npm test login:test-ok`.
- **Human** — plain instructions for a person.
- **AI** — plain instructions for an AI verifier.

Switching modes keeps the text entered for each mode. Root chapters do not show
verification rules and are excluded from coverage.

The **Test coverage** page lists every verification-eligible chapter, but only
Auto-test chapters with a command count as covered. Human and AI chapters are
shown as uncovered context. Each project has a shared **Test guidelines** field
that is editable directly on the coverage page and is included in exports.

Each document header has a delete action. Deleting asks for confirmation and
removes the chapter, every subchapter beneath it, and any success criterion in
its parent that created it.

## Architecture

```text
server/          Fastify API, SQLite store, migrations, seed, OpenAPI routes
src/domain/      Pure models: projects, chapters, criteria, verification, schema
src/api/         Fetch client and typed project/document/activity calls
src/store/       React providers for the project catalog and active workspace
src/hooks/       Hash router, memoized chapter tree, focus trap
src/components/  Sidebar, project switcher/page/dialogs, tree, editor, banners
src/app/         App shell, per-project workspace shell, error boundaries
src/Markdown.tsx Markdown preview/editor primitives
src/data.ts      Sample projects used by the API seed
docs/api.md      Short API/agent guide
AGENTS_template.md  Instructions for AI agents using the API
```

- **API is the source of truth.** The React app loads projects, documents,
  activity and guidelines over HTTP. There is no mock repository and no
  `localStorage` fallback.
- **Separate revisions for metadata and documents.** Project settings use a
  metadata revision; document writes use a document revision. Both use
  `If-Match` and return quoted integer ETags. A stale write returns
  `412 revision_conflict`.
- **Document-oriented writes.** The document resource contains the existing
  normalized `{ byId, rootIds }` chapters plus the selected chapter. A document
  write may also carry new activity entries so one client action is persisted
  atomically.
- **SQLite behind a store interface.** `server/db/store.ts` owns all SQL. Routes
  depend on `ProjectStore`, so a future phase can add a Postgres adapter without
  changing the API or React client. No Postgres driver is present now.
- **Shared domain rules.** The server reuses `src/domain` for normalization,
  project summaries, verification modes and coverage calculations. UI and API
  cannot diverge on those rules.
- **One command for the stack.** `npm run dev` starts Fastify, migrations and
  Vite. `npm start` serves the built UI and API from the same origin.
- **Optimistic conflict handling.** If another tab or agent changed a document,
  the client stops autosaving and offers **Reload latest** or **Overwrite
  server**. The latter is explicit and destructive.

### Database

The database is created automatically. Migrations live in
`server/db/migrations/`.

| Table               | Contents                                                      |
| ------------------- | ------------------------------------------------------------- |
| `projects`          | Metadata, guidelines, stats, metadata revision and timestamps |
| `project_documents` | Normalized chapters, selected chapter and document revision   |
| `activity_entries`  | Append-only activity, newest first, capped at 100 per project |
| `app_state`         | Active project selection                                      |
| `schema_migrations` | Applied database migrations                                   |

WAL mode, foreign keys and a busy timeout are enabled. Project deletion cascades
to its document and activity. `npm run db:reset` deletes the database, reapplies
migrations and seeds the sample projects when `LAYERS_SEED_SAMPLES` is enabled.

Project **Export project** downloads a `layers-project` version 3 JSON file;
the file includes an embedded `instructions` field explaining the format for
AI agents and other consumers. **Import project** uploads one through the API.
Imports always create a new project, never overwrite, and get an `(imported)`
suffix on name collisions. Older v1/v2 files remain importable.

### API

| Method   | Path                             | Purpose                       |
| -------- | -------------------------------- | ----------------------------- |
| `GET`    | `/api/v1/health`                 | API and database check        |
| `GET`    | `/api/v1/projects`               | Catalog and active project    |
| `POST`   | `/api/v1/projects`               | Create a project              |
| `GET`    | `/api/v1/projects/:id`           | Project detail and guidelines |
| `PATCH`  | `/api/v1/projects/:id`           | Update metadata/guidelines    |
| `DELETE` | `/api/v1/projects/:id`           | Delete a project              |
| `POST`   | `/api/v1/projects/:id/duplicate` | Duplicate a project           |
| `POST`   | `/api/v1/projects/:id/activate`  | Set the active project        |
| `GET`    | `/api/v1/projects/:id/document`  | Read the document             |
| `PUT`    | `/api/v1/projects/:id/document`  | Replace the document          |
| `GET`    | `/api/v1/projects/:id/activity`  | Read activity                 |
| `POST`   | `/api/v1/projects/:id/activity`  | Append activity               |
| `GET`    | `/api/v1/projects/:id/coverage`  | Derived verification coverage |
| `GET`    | `/api/v1/projects/:id/export`    | Download a project file       |
| `POST`   | `/api/v1/projects/import`        | Import a project file         |

See [`docs/api.md`](docs/api.md) for revision rules and examples. Error responses
use `{ "error": { "code", "message", "details" } }`.

### Routes

Hash routing keeps every project and chapter linkable and survives reload:

- `#/projects` — project list
- `#/projects/<projectId>/chapters/<chapterId>` — specifications
- `#/projects/<projectId>/coverage` — automated test coverage
- `#/projects/<projectId>/activity` — project activity

Unknown project ids return to the project list; unknown chapter ids fall back to
the first chapter and the URL is rewritten. The active project is stored by the
API.

## Verify

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

`npm test` runs the unit, API, contract and browser suites. The browser suite
starts the API and UI through `npm run dev:e2e`, uses a dedicated SQLite file and
resets it before each test. The production smoke test builds the UI and server,
resets a temporary database and runs Chromium against `npm start`.

The browser suite covers the phase 1–4 scenarios plus API-backed persistence,
optimistic conflict handling, retry after API failure, export/import through the
API, project lifecycle, project isolation, project-scoped routing, activity,
verification modes, coverage counting, accessibility (axe) and focus
management.

## Runtime boundaries

- No authentication, accounts, permissions or collaboration. The API is
  loopback-only and single-user.
- No remote deployment, TLS, Postgres support or database selection yet. All SQL
  stays behind `server/db` so that work can be added later.
- No offline mode. The app requires the local API.
- No WebSocket/SSE live updates. A tab refreshes on focus and uses optimistic
  conflict handling for concurrent writes.
- Test coverage is declaration-based: commands are stored and counted, but not
  executed, and no test reports or results are recorded.
- Chapter deletion is available with confirmation and subtree cleanup. Reordering
  and drag-and-drop remain tested domain operations without UI.
- Import never overwrites or merges into an existing project.
- Activity history is capped at 100 entries and is not yet a durable audit log.

## Tests and tooling

- **Vitest** — domain unit tests, API client unit tests, Fastify integration
  tests with in-memory SQLite, and OpenAPI contract tests.
- **Playwright** — Chromium UI tests against the real API and SQLite, with one
  worker and a test-only database reset endpoint.
- **TypeScript** — client and server type checking through separate configs.
- **ESLint + Prettier** — lint and formatting checks.
- **OpenAPI** — Redocly lint, generated types and a served Scalar reference.
- **CI** — `.github/workflows/ci.yml` runs the full quality gate on pushes and
  pull requests.
