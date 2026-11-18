# Layers

A local workspace for project specifications. Create projects, and inside each
project create chapters and nested subchapters. Each chapter has an editable
Markdown description, verification rules and a success-criteria checklist.

Everything is stored in a local Fastify API backed by SQLite. Accounts and
sessions protect the API, projects are private to their owner, and local AI
agents use project-bound MCP API keys or OAuth connections. There is no cloud service and no browser
`localStorage` persistence. The React UI is one client of the API.

## Run

Node 22 or newer is required.

```sh
npm install
cp .env.example .env
# edit LAYERS_SUPER_ADMIN_EMAIL and LAYERS_SUPER_ADMIN_PASSWORD
npm run dev
```

`npm run dev` starts the API at `http://127.0.0.1:3001` and the Vite UI at
`http://127.0.0.1:5173`. The SQLite database defaults to `data/layers.sqlite`
and is migrated automatically. The first run creates the super admin from
`.env` and seeds the **Website project** and **Mobile app** samples, owned by
that super admin.

`.env` is ignored by git and contains a plaintext super-admin password. Restrict
its file permissions and never commit it.

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

| Variable                           | Default                     | Meaning                                             |
| ---------------------------------- | --------------------------- | --------------------------------------------------- |
| `HOST`                             | `127.0.0.1`                 | API bind address                                    |
| `PORT`                             | `3001`                      | API port                                            |
| `LAYERS_DB_PATH`                   | `data/layers.sqlite`        | SQLite database file                                |
| `LAYERS_SEED_SAMPLES`              | `1`                         | Seed samples when the database is empty             |
| `LAYERS_TEST_MODE`                 | `0`                         | Enable the test-only reset endpoint                 |
| `LAYERS_ALLOW_REMOTE`              | `0`                         | Allow a non-loopback bind                           |
| `LAYERS_SUPER_ADMIN_EMAIL`         | none                        | Super-admin login email; required outside test mode |
| `LAYERS_SUPER_ADMIN_PASSWORD`      | none                        | Super-admin password, at least 12 characters        |
| `LAYERS_SUPER_ADMIN_NAME`          | `Super Admin`               | Super-admin display name                            |
| `LAYERS_SESSION_TTL_DAYS`          | `30`                        | Sliding browser-session lifetime                    |
| `LAYERS_SECURE_COOKIES`            | `0`                         | Set `Secure` on the session cookie                  |
| `LAYERS_UI_ORIGIN`                 | `http://127.0.0.1:5173`     | Extra allowed browser origin                        |
| `LAYERS_LOGIN_RATE_LIMIT`          | `5`                         | Login attempts per window                           |
| `LAYERS_LOGIN_RATE_WINDOW_MINUTES` | `15`                        | Login rate-limit window                             |
| `LAYERS_MCP_ALLOWED_HOSTS`         | `localhost,127.0.0.1,[::1]` | Allowed MCP request hostnames                       |
| `LAYERS_PUBLIC_URL`                | none                        | Public origin; enables MCP OAuth when set           |
| `VITE_API_URL`                     | `/api/v1`                   | Browser API base URL                                |

The server refuses a non-loopback bind unless `LAYERS_ALLOW_REMOTE=1`.
Authentication is always required outside test mode. The default loopback bind
is for local development; the Docker image uses a non-loopback bind. Remote
deployment is documented below.

## Docker image

Every push to `main` publishes a public `linux/amd64` image to GitHub Container
Registry after the CI quality gate passes:

```sh
docker pull ghcr.io/festoinc/layer-plan:latest
```

Tags are `latest` and `sha-<7>`. Only the newest published version is kept, so
there is no digest rollback: reverting means reverting the commit. No nginx or
other process is included; Fastify serves the built UI and the API from the same
container on port `3001`.

The image contains production artefacts only, runs as the non-root `node` user,
and reads its SQLite database from `/app/data/layers.sqlite`. Sample seeding is
off, so a fresh install starts with no projects.

### Run with Compose

`docker-compose.yml` runs the app with a named volume, publishes port 80 by
default and reads configuration from `.env`:

```sh
cp .env.example .env
# edit LAYERS_SUPER_ADMIN_EMAIL and LAYERS_SUPER_ADMIN_PASSWORD
docker compose pull
docker compose up -d
docker compose ps
```

Open `http://<server>/`. Set `LAYERS_HTTP_PORT` in `.env` if port 80 is
occupied. `docker compose pull && docker compose up -d` upgrades to the newest
image; the `layers-data` volume survives restart and upgrade.

Standalone equivalent:

```sh
docker run -d --name layers --restart unless-stopped -p 80:3001 \
  -e LAYERS_SUPER_ADMIN_EMAIL=admin@example.com \
  -e LAYERS_SUPER_ADMIN_PASSWORD='at-least-12-characters' \
  -v layers-data:/app/data \
  ghcr.io/festoinc/layer-plan:latest
```

The image defaults `HOST=0.0.0.0`, `LAYERS_ALLOW_REMOTE=1`,
`LAYERS_DB_PATH=/app/data/layers.sqlite` and `LAYERS_SEED_SAMPLES=0`.
`LAYERS_SUPER_ADMIN_EMAIL` and `LAYERS_SUPER_ADMIN_PASSWORD` are always
required. The password bootstraps the super admin on a fresh database. After
that, change it from `#/account`; editing `.env` no longer overwrites the stored
password.

### Persistence and backup

Data lives in the `layers-data` volume. A host bind mount also works but must be
writable by uid/gid `1000`. Back up with the container stopped so the SQLite WAL
is consistent:

```sh
docker compose stop app
docker run --rm -v layers-data:/data:ro -v "$PWD":/backup \
  alpine tar czf /backup/layers-data.tar.gz -C /data .
docker compose start app
```

There is no TLS, reverse proxy or automatic deployment. Do not expose the port
publicly without a TLS terminator; `LAYERS_SECURE_COOKIES=1` is only correct
behind HTTPS. The health endpoint is `GET /api/v1/health`.

## Authentication and accounts

- The super admin is configured in `.env` and synchronized into SQLite at
  startup. The env password creates the account on a fresh database; the stored
  password is changed from the account page.
- Sign in at `#/sign-in` with the super-admin email and password.
- The super admin creates member accounts at `#/users` by entering an email and
  password. No email is sent. Member passwords cannot be changed or recovered.
- The super admin changes their own password at `#/account` by entering the
  current password and the new password twice. Other browser sessions are signed
  out; the current session stays signed in.
- Each user owns their projects. Another user's project returns `404`, including
  for the super admin. The super admin manages users but does not bypass project
  ownership.
- The account page at `#/account` lists browser sessions.
- MCP credentials are managed from a project's actions menu (**MCP access**).
  API keys are shown once, stored hashed, and can be read-only or read-write.
  They default to read-write and expire after 3650 days. A user can have 20
  active keys.
- OAuth clients authorize through the browser consent page, choose one project
  and read-only or read-write access, and receive short-lived access tokens plus
  rotating refresh tokens. Connected apps are listed and revocable from **MCP
  access**.
- Both credential types work only with `/mcp` and only for their project; they
  cannot call the REST API or reach another project.
- Login is rate-limited. Browser sessions use an `HttpOnly`, `SameSite=Lax`
  cookie and are never stored in `localStorage`.

MCP client examples:

```sh
# Clients with a bearer-token field
export LAYERS_API_TOKEN=lrs_...
codex mcp add layers --url https://<domain>/mcp \
  --bearer-token-env-var LAYERS_API_TOKEN
```

OAuth-only clients use the same URL and discover the authorization server from
`/mcp`. Set `LAYERS_PUBLIC_URL` to the public origin (for example
`https://layers.example.com`) before starting the server. The client opens the
Layers consent page; sign in, choose a project and approve access.

## Usage

The sidebar project switcher opens the project menu. **All projects** opens the
projects page where you can create, rename, duplicate, export, import and delete
projects. Each project keeps its own chapters, verification rules, activity,
selected chapter, test coverage and test guidelines.

Each project also has a **Search** view. Search is limited to the current
project and covers chapter titles, descriptions, criteria, commit hashes and
verification text. Results link back to the matching chapter.

Inside a project, use the **+** next to a chapter to add a subchapter, or **New
chapter** to create a top-level chapter. Click a chapter to edit its title,
description, and checklist. Descriptions and success criteria support
GitHub-flavored Markdown. Text displays formatted by default; double-click a
description or checklist item to edit its Markdown, or focus it and press
Enter/F2. Press Escape or Ctrl/Cmd+Enter to finish editing.

Adding a success criterion also creates a subchapter under the current chapter
unless **Final level** is checked. The backend applies the same rule for REST
and MCP document writes. Its title comes from the first line of the criterion.
The checklist item and its subchapter stay synchronized: editing either side
updates the other, and deleting one deletes the other. A link button on the
criterion opens its subchapter, and the subchapter shows which criterion created
it. Manually created subchapters do not add checklist items. Press Enter to add
a criterion and Shift+Enter for a new line. Changes save automatically to the
local API.

### Commit references

Every document has a compact **Commits** row under its title. Paste a git commit
hash and choose **Add** to record that the commit implemented the document. A
document can reference several commits, for example when it is improved over
time. Commits are shown newest first and each chip can be removed. Removing a
commit never changes success criteria or verification state.

Hashes are 7–40 hexadecimal characters. Input is case-insensitive and stored in
lowercase. Invalid hashes are rejected, duplicate hashes are ignored, and a
document can reference at most 50 commits. Links are manual only: Layers never
reads a git repository or contacts a git host, and it does not store commit
messages, authors, dates or URLs. The **Test coverage** page shows each
chapter's newest commit.

### Search

Open **Search** in the project sidebar to find a chapter by keyword or commit
prefix. Search covers chapter titles, descriptions, criteria, commit hashes and
the Auto-test, Human and AI verification text. It searches only the current
project; activity and project metadata are not included. Results show the
chapter path and highlighted snippets, and selecting one opens the chapter.
Search never changes the document or its revision.

### Attachments

Every project document can hold supporting files. Open **Attachments** in the
project sidebar, or use the paperclip in the document header, to add, download
and remove them. PDF, CSV/TSV, text, Markdown, log, JSON, YAML, TOON, JPEG, PNG,
XLS/XLSX, DOCX and PPTX are accepted, up to 10 MiB each and 20 files per
project. Text formats are checked as UTF-8, image and PDF signatures are
verified, and OOXML packages must contain their expected document part. The browser validates the extension and size first, then
the API checks the file signature and stores the bytes in SQLite. Attachment
changes appear in activity but do not change the document or metadata revision,
so uploading a file does not conflict with an open editor. Duplicating a project
copies its attachments; JSON export/import does not include them.

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
shown as uncovered context. Each row shows the chapter's linked commits. Each
project has a shared **Test guidelines** field that is editable directly on the
coverage page and is included in exports.

Each document header has a delete action. Deleting asks for confirmation and
removes the chapter, every subchapter beneath it, and any success criterion in
its parent that created it.

## Architecture

```text
server/          Fastify API, SQLite store, migrations, seed, OpenAPI routes
src/domain/      Pure models: projects, chapters, criteria, commits, attachments, search, verification
src/api/         Fetch client and typed project/document/activity/search calls
src/store/       Auth, project catalog and active workspace providers
src/hooks/       Hash router, memoized chapter tree, focus trap
src/components/  Sidebar, projects, auth/account/users pages, editor, banners
src/app/         Auth gate, app shell, workspace shell, error boundaries
src/Markdown.tsx Markdown preview/editor primitives
src/data.ts      Sample projects used by the API seed
docs/api.md      Short API/agent guide
LAYERS_AGENT_GUIDE.md  Instructions for AI agents using the MCP endpoint
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

| Table                          | Contents                                                    |
| ------------------------------ | ----------------------------------------------------------- |
| `users`                        | Email, display name, password hash, role and disabled state |
| `sessions`                     | Hashed browser-session tokens and expiry                    |
| `api_tokens`                   | Project-bound MCP keys, scopes, expiry and revocation       |
| `oauth_clients`                | Dynamically registered MCP OAuth clients                    |
| `oauth_grants`                 | Project-bound OAuth connections and hashed tokens           |
| `oauth_authorization_requests` | Pending consent requests                                    |
| `oauth_authorization_codes`    | Single-use OAuth authorization codes                        |
| `projects`                     | Owner, metadata, guidelines, stats and revisions            |
| `project_documents`            | Normalized chapters, selected chapter and document revision |
| `activity_entries`             | Append-only activity with actor attribution                 |
| `attachments`                  | Project-document files, metadata, SHA-256 and content BLOB  |
| `user_state`                   | Per-user active project                                     |
| `app_state`                    | Legacy global state; migrated and unused after phase 6      |
| `schema_migrations`            | Applied database migrations                                 |

WAL mode, foreign keys and a busy timeout are enabled. Project deletion cascades
to its document, activity and attachments. `npm run db:reset` deletes the database, reapplies
migrations, creates the super admin and seeds the sample projects when
`LAYERS_SEED_SAMPLES` is enabled.

Project **Export project** downloads a `layers-project` version 3 JSON file;
the file includes an embedded `instructions` field explaining the format for
AI agents and other consumers. **Import project** uploads one through the API.
Imports always create a new project, never overwrite, and get an `(imported)`
suffix on name collisions. Older v1/v2 files remain importable.

### API

| Method       | Path                                                     | Purpose                             |
| ------------ | -------------------------------------------------------- | ----------------------------------- |
| `GET`        | `/api/v1/health`                                         | Public API and database check       |
| `POST`       | `/api/v1/auth/login`                                     | Sign in and set a session cookie    |
| `POST`       | `/api/v1/auth/logout`                                    | Sign out                            |
| `GET`        | `/api/v1/auth/session`                                   | Current browser session             |
| `GET`        | `/api/v1/me`                                             | Current user for a browser session  |
| `POST`       | `/api/v1/me/password`                                    | Change the super-admin password     |
| `GET/DELETE` | `/api/v1/auth/sessions`                                  | List or revoke other sessions       |
| `GET/POST`   | `/api/v1/projects/:id/tokens`                            | List or create MCP API keys         |
| `DELETE`     | `/api/v1/projects/:id/tokens/:tokenId`                   | Revoke a project API key            |
| `GET`        | `/api/v1/projects/:id/oauth-grants`                      | List OAuth connections              |
| `DELETE`     | `/api/v1/projects/:id/oauth-grants/:grantId`             | Revoke an OAuth connection          |
| `GET`        | `/api/v1/oauth/authorize/:requestId`                     | Read a pending consent request      |
| `POST`       | `/api/v1/oauth/authorize/:requestId/decision`            | Approve or deny consent             |
| `GET/POST`   | `/api/v1/users`                                          | Super-admin user management         |
| `GET`        | `/api/v1/projects`                                       | Owned catalog and active project    |
| `POST`       | `/api/v1/projects`                                       | Create a project                    |
| `GET`        | `/api/v1/projects/:id`                                   | Project detail and guidelines       |
| `PATCH`      | `/api/v1/projects/:id`                                   | Update metadata/guidelines          |
| `DELETE`     | `/api/v1/projects/:id`                                   | Delete a project                    |
| `POST`       | `/api/v1/projects/:id/duplicate`                         | Duplicate a project                 |
| `POST`       | `/api/v1/projects/:id/activate`                          | Set the active project              |
| `GET`        | `/api/v1/projects/:id/document`                          | Read the document                   |
| `PUT`        | `/api/v1/projects/:id/document`                          | Replace the document                |
| `GET/POST`   | `/api/v1/projects/:id/attachments`                       | List or upload document attachments |
| `GET/DELETE` | `/api/v1/projects/:id/attachments/:attachmentId`         | Read metadata or delete one         |
| `GET`        | `/api/v1/projects/:id/attachments/:attachmentId/content` | Download content                    |
| `GET`        | `/api/v1/projects/:id/activity`                          | Read activity                       |
| `POST`       | `/api/v1/projects/:id/activity`                          | Append activity                     |
| `GET`        | `/api/v1/projects/:id/coverage`                          | Derived verification coverage       |
| `GET`        | `/api/v1/projects/:id/search`                            | Search one project                  |
| `GET`        | `/api/v1/projects/:id/export`                            | Download a project file             |
| `POST`       | `/api/v1/projects/import`                                | Import a project file               |

REST routes require a browser session cookie. Project API keys and OAuth access
tokens are accepted only by `/mcp`. Standard OAuth and discovery routes live
outside `/api/v1`; see [`docs/api.md`](docs/api.md) for the flow, login, key
management, revision rules and examples.
Error responses use `{ "error": { "code", "message", "details" } }`.

### Routes

Hash routing keeps every project and chapter linkable and survives reload:

- `#/sign-in` — sign in
- `#/account` — account and browser sessions
- `#/users` — super-admin user management
- `#/projects` — project list
- `#/projects/<projectId>/chapters/<chapterId>` — specifications
- `#/projects/<projectId>/coverage` — automated test coverage
- `#/projects/<projectId>/activity` — project activity
- `#/projects/<projectId>/search?q=<query>` — project search

Unknown project ids return to the project list; unknown chapter ids fall back to
the first chapter and the URL is rewritten. The active project is stored per
user by the API.

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

The browser suite covers the phase 1–6 scenarios plus sign-in and session
handling, project API-key management, super-admin password change, super-admin user creation and
disablement, two-user project isolation, API-backed persistence, optimistic
conflict handling, retry after API failure, export/import, project lifecycle,
project-scoped routing, activity, verification modes, coverage counting,
project search, accessibility (axe) and focus management.

## Runtime boundaries

- Authentication and private project ownership are available. Collaboration,
  project roles, sharing and invitations are not.
- Super-admin self-service password change is available. Member password
  changes, password recovery, admin resets, email verification and email
  delivery are not.
- A public `linux/amd64` Docker image is published, but deployment is manual.
  There is no TLS, reverse proxy, automated deployment, ARM image or database
  selection yet. All SQL stays behind `server/db` so that work can be added
  later.
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

- **Vitest** — domain and auth unit tests, API client unit tests, Fastify
  integration tests with in-memory SQLite, and OpenAPI contract tests.
- **Playwright** — Chromium UI tests against the real API and SQLite, with one
  worker, a test-only database reset endpoint and test-mode super-admin
  credentials.
- **TypeScript** — client and server type checking through separate configs.
- **ESLint + Prettier** — lint and formatting checks.
- **OpenAPI** — Redocly lint, generated types and a served Scalar reference.
- **CI** — `.github/workflows/ci.yml` runs the full quality gate on pushes and
  pull requests. On a push to `main` it also builds the Docker image,
  smoke-tests the container and publishes `latest` and `sha-<7>` to GHCR,
  deleting older package versions.

### Remote Codex access

Layers exposes its project, document and attachment operations over MCP at
`/mcp`.
Create an API key for one project in that project's actions menu (**MCP
access**), or let an OAuth-only client authorize itself through the consent
page. Either credential is bound to that project and accepted only by `/mcp`;
it cannot create, import, duplicate or activate projects, and project export
and deletion stay REST and UI only. The agent guide ships
as the MCP `initialize` instructions and as the `how_to_work_with_this_mcp`
tool for clients that do not surface them. Before remote access,
set `LAYERS_MCP_ALLOWED_HOSTS` and, for OAuth, `LAYERS_PUBLIC_URL`, then
configure HTTPS with a private backend; the default Docker Compose port is
publicly bound and needs a loopback override behind a local reverse proxy. See
[Remote Codex MCP access](docs/api.md#remote-codex-mcp-access) and
[MCP OAuth authorization](docs/api.md#mcp-oauth-authorization) for setup, token
handling, and limits.
