# Layers agent guide — project documentation over MCP

## Your role

You are an assistant helping a person create, adjust and discuss project
documentation in the Layers workspace. You may also prepare and run tests when
they are needed to check documentation or implementation work.

You are not the product owner. Prefer clarifying questions over guessing when
the requested change is ambiguous. Ask for explicit confirmation before
destructive actions such as deleting a project or chapter, overwriting a
conflicting document, resetting the local database, or changing data outside the
project the person asked about.

Your normal responsibilities are:

- read and understand the current project structure before changing it;
- create or edit chapters, descriptions, success criteria, verification rules
  and commit references through the Layers API;
- help discuss and improve wording, scope, acceptance criteria and test
  coverage;
- prepare tests or verification steps when asked;
- report what you changed and any risks or unresolved questions.

Do not invent project IDs, chapter IDs, criterion IDs or existing content. Read
them from the API first.

## Collaboration mode: one document at a time

Work interactively. In Layers, a “document” is one chapter or subchapter page
inside a project. The expected rhythm is:

1. agree which document to work on;
2. read its current content and surrounding structure;
3. discuss and apply the changes for that document;
4. review the result and verify that it is complete enough to finalize;
5. only then move to the next document.

Do not turn a collaborative session into a bulk data-entry job. Do not collect
all source material and attempt to fill hundreds of documents in one pass. Do
not create or rewrite large batches of chapters, descriptions or criteria unless
the person explicitly asks for a bulk import or migration.

If a batch operation is explicitly requested, clarify its scope, source format
and destination first, and keep it separate from normal document-by-document
work. Otherwise, stop at each document boundary and ask before continuing.

## Project context

This repository contains Layers, a local project-specification workspace.

- React UI: `http://127.0.0.1:5173` during development
- API: `http://127.0.0.1:3001/api/v1`
- Interactive API docs: `http://127.0.0.1:3001/api/v1/docs`
- Normative OpenAPI document: `server/api/openapi.yaml`
- Short API examples: `docs/api.md`
- SQLite database: `data/layers.sqlite` by default

The REST API is local-only by default and authenticated. Browser clients use an
`HttpOnly` session cookie. MCP clients use a project API key or an OAuth
connection for `/mcp`; never ask the person for their password, key, OAuth code
or access token. Do not expose the REST API beyond loopback. Do not change `HOST` to a public interface unless the person explicitly
asks for that and understands the security implications.

The API is the source of truth. Do not edit SQLite directly, do not use browser
`localStorage`, and do not modify files under `data/` while the API is running.

## Authentication for agents

Use the Layers MCP endpoint at `/mcp` with a project API key or an OAuth
connection. The person creates a key in the project actions menu (**MCP
access**), or approves an OAuth client through the Layers consent page. The
credential is bound to exactly one project and is accepted only by `/mcp`; it
cannot call the REST API. Never ask for a key, OAuth code or access token in
chat. For a key, put it in the MCP client environment, for example
`LAYERS_API_TOKEN`, and configure the client to send it as a bearer token to
`https://<domain>/mcp`. OAuth-only clients discover the authorization server
from the same URL; the person approves one project in the browser.

The REST examples below are for a signed-in browser session, not for a project
key. Use a cookie jar from `curl -c` / `curl -b`:

```sh
AUTH='-b /tmp/layers-cookies.txt'
```

Use `$AUTH` on every REST call. Project ids are private to their owner. Another
user's project returns `404`, including for the super admin. Never assume a
project id belongs to the current session's user.

When MCP returns `401 unauthenticated`, stop and ask the person to reconnect
through the MCP client's authorization flow, or create a new key. Do not retry
in a loop and do not ask for credentials in chat. `403 forbidden` means the
credential scope does not allow the operation or the project does not match the
bound project.

## Start or check the stack

```sh
npm install
npm run dev
```

`npm run dev` starts the API, SQLite migrations and the Vite UI. Check the API:

```sh
curl -sS http://127.0.0.1:3001/api/v1/health
```

If the API is already running, use it. Do not restart or reset it unless
necessary.

Useful commands:

```sh
npm run dev:api       # API only
npm run dev:ui        # UI only
npm run db:migrate    # apply migrations
npm run db:reset      # destructive: deletes and reseeds the local database
npm run api:types     # regenerate types from OpenAPI
npm run api:lint      # validate the OpenAPI document
```

`npm run db:reset` removes the local database. Ask before running it.

## API basics

Base URL: `http://127.0.0.1:3001/api/v1`

| Method       | Path                                              | Purpose                             |
| ------------ | ------------------------------------------------- | ----------------------------------- |
| `POST`       | `/auth/login`                                     | Browser sign-in; sets a cookie      |
| `POST`       | `/auth/logout`                                    | Browser sign-out                    |
| `GET`        | `/auth/session`                                   | Current browser session             |
| `GET`        | `/me`                                             | Current user for a browser session  |
| `GET/DELETE` | `/auth/sessions`                                  | List or revoke other sessions       |
| `GET/POST`   | `/projects/:id/tokens`                            | List or create MCP keys             |
| `DELETE`     | `/projects/:id/tokens/:tokenId`                   | Revoke a project key                |
| `GET/POST`   | `/users`                                          | Super-admin user management         |
| `GET`        | `/projects`                                       | List projects and active project    |
| `POST`       | `/projects`                                       | Create a project                    |
| `GET`        | `/projects/:id`                                   | Read metadata and guidelines        |
| `PATCH`      | `/projects/:id`                                   | Update metadata or guidelines       |
| `DELETE`     | `/projects/:id`                                   | Delete a project                    |
| `POST`       | `/projects/:id/duplicate`                         | Duplicate a project                 |
| `POST`       | `/projects/:id/activate`                          | Set the active project              |
| `GET`        | `/projects/:id/document`                          | Read the document                   |
| `PUT`        | `/projects/:id/document`                          | Replace the document                |
| `GET/POST`   | `/projects/:id/attachments`                       | List or upload document attachments |
| `GET/DELETE` | `/projects/:id/attachments/:attachmentId`         | Read metadata or delete one         |
| `GET`        | `/projects/:id/attachments/:attachmentId/content` | Download content                    |
| `GET`        | `/projects/:id/activity`                          | Read activity                       |
| `POST`       | `/projects/:id/activity`                          | Append an activity entry            |
| `GET`        | `/projects/:id/coverage`                          | Read verification coverage          |
| `GET`        | `/projects/:id/search`                            | Search one project                  |
| `GET`        | `/projects/:id/export`                            | Download a project file             |
| `POST`       | `/projects/import`                                | Import a project file               |

See `server/api/openapi.yaml` for exact request and response schemas. When the
contract and an old example disagree, the OpenAPI document wins.

## Read before writing

1. List projects:

```sh
curl -sS $AUTH http://127.0.0.1:3001/api/v1/projects
```

2. Read the project and its document. Save the document `ETag`:

```sh
PROJECT_ID=website

curl -sS $AUTH -D /tmp/layers-project.headers \
  "http://127.0.0.1:3001/api/v1/projects/$PROJECT_ID"

curl -sS $AUTH -D /tmp/layers-document.headers \
  "http://127.0.0.1:3001/api/v1/projects/$PROJECT_ID/document" \
  -o /tmp/layers-document.json
```

3. Inspect the chapter tree and current verification rules before editing:

```sh
jq '.selectedId, (.chapters.byId | keys)' /tmp/layers-document.json
jq '.chapters.byId["<chapter-id>"]' /tmp/layers-document.json
```

`jq` is optional; any JSON reader is fine.

## Document model

The document is a normalized tree:

```json
{
  "schemaVersion": 7,
  "projectId": "website",
  "revision": 12,
  "updatedAt": "2026-11-11T18:00:00.000Z",
  "chapters": {
    "byId": {
      "login": {
        "id": "login",
        "parentId": "authentication",
        "title": "Login form",
        "description": "Markdown description.",
        "finalLevel": false,
        "verification": {
          "mode": "auto",
          "auto": { "command": "npm test login:test-ok" },
          "human": { "instructions": "" },
          "ai": { "instructions": "" }
        },
        "criteria": [
          {
            "id": "login-1",
            "text": "Login can be entered",
            "checked": true
          }
        ],
        "commits": ["4f2a9c1"],
        "childIds": []
      }
    },
    "rootIds": ["authentication"]
  },
  "selectedId": "login"
}
```

Rules to preserve:

- `byId` keys are chapter IDs.
- `rootIds` contains top-level chapter IDs in display order.
- Every chapter has `parentId`, `childIds`, `criteria`, `commits` and
  `verification`.
- Every criterion has `id`, `text` and `checked`.
- Adding a new criterion to a non-final chapter creates a subchapter on the
  backend with a fresh id, a title derived from the criterion's first line, the
  full criterion Markdown as its description, the parent id, and a `chapterId`
  link on the criterion. Do not create that subchapter yourself in an MCP
  document write; send the criterion without `chapterId` and use the chapter
  returned by the write. Final-level chapters, existing criteria, already-linked
  criteria and empty text are skipped. Never backfill old criteria.
- A criterion may have `chapterId` when it created a subchapter. The criterion
  text and the subchapter are one synchronized pair: the subchapter `description`
  is exactly the criterion text and its `title` is derived from the first line.
  - Editing the criterion text updates the subchapter title and description.
  - Editing only the subchapter description updates the criterion text.
  - Editing only the subchapter title rewrites the first line of the criterion
    text and keeps the remaining lines.
  - If both sides change in one write, the criterion text wins.
  - Deleting a criterion deletes the subchapter and its whole subtree; deleting
    the subchapter deletes the criterion.
  - Removing only `chapterId` detaches the pair; both records survive and the
    chapter becomes an ordinary manual chapter. Save that detach before deleting
    the criterion, otherwise the chapter is deleted with it. Moving the chapter
    out of the criterion's chapter detaches it too.
  - A new criterion that names an existing chapter makes the criterion text
    canonical and overwrites that chapter's title and description.
- Document write responses include `criterionSync` with `updatedSubchapters`,
  `removedSubchapters` and `removedCriteria`; read the returned document instead
  of computing the changes yourself.
- `verification.mode` is exactly `auto`, `human` or `ai`.
- Each mode keeps its own text, even when inactive.
- `commits` lists the git commits that implemented the document, newest first.
  Each value is a lowercase 7–40 character hexadecimal hash. Commit references
  are informational and never change criterion or verification state.
- Root chapters may have criteria but are excluded from verification coverage.
- `selectedId` must be `null` or an existing chapter ID.
- Do not add unknown fields. The API validates the contract strictly.

Descriptions and criterion text support GitHub-flavored Markdown.

## Safe write recipe

`PUT /projects/:id/document` replaces the whole document. Modify a copy of the
document you just read and send it back. Do not construct the document from
scratch when editing an existing project.

1. Get the current revision from the `ETag` header:

```sh
REVISION=$(awk 'tolower($1) == "etag:" { gsub(/"/, "", $2); print $2 }' \
  /tmp/layers-document.headers)
```

2. Edit `/tmp/layers-document.json` with a script or a temporary file.

3. Send the complete document with `If-Match`:

```sh
curl -sS $AUTH -X PUT \
  "http://127.0.0.1:3001/api/v1/projects/$PROJECT_ID/document" \
  -H 'Content-Type: application/json' \
  -H "If-Match: \"$REVISION\"" \
  --data @/tmp/layers-document-write.json
```

The write body is:

```json
{
  "chapters": { "byId": {}, "rootIds": [] },
  "selectedId": "password-reset",
  "activity": [
    {
      "id": "new-uuid",
      "message": "Updated the reset flow",
      "chapterId": "password-reset",
      "chapterName": "Password reset"
    }
  ]
}
```

`activity` is optional and must contain only new entries. Do not resend the
existing activity history. Generate a fresh ID for each new entry. The server
assigns timestamps and keeps the newest 100 entries.

4. Save the new `ETag` from the response and use it for the next write.

## Optimistic concurrency

Every document write needs `If-Match`:

- missing header: `428 precondition_required`;
- stale revision: `412 revision_conflict`;
- success: `200` with a new `ETag`.

On `412`, do not blindly retry with the same data. Read the latest document,
compare it with the intended change, and either:

- rebase the change onto the latest document and write again; or
- ask the person before overwriting the other version.

Project metadata and guidelines use the same `If-Match` rule through
`PATCH /projects/:id` and `DELETE /projects/:id`.

## Activity

Use activity for meaningful documentation changes that a person would want to
see in the activity page. The server stores activity newest-first and caps it at
100 entries.

For a document write, include new entries in the `activity` array. For a
standalone note, use:

```sh
curl -sS $AUTH -X POST \
  "http://127.0.0.1:3001/api/v1/projects/$PROJECT_ID/activity" \
  -H 'Content-Type: application/json' \
  -d '{"message":"Reviewed AI verification instructions","chapterId":null,"chapterName":"Website project"}'
```

Do not attempt to edit or delete activity. There is no endpoint for that.

## Commit references

Every chapter has a `commits` array. Add a hash when a commit implemented the
document, and keep several hashes when the document was improved over time.
Newest is first.

Rules:

- use lowercase 7–40 character hexadecimal hashes; uppercase input is
  normalized by the API;
- do not invent hashes; use the value supplied by the person or committed in the
  repository;
- do not link a commit to a success criterion — commits belong to documents
  only;
- do not add commit messages, authors, dates, branches or URLs;
- never claim that a commit verifies a criterion; the field is a reference only;
- removing a commit is done by omitting it from the full-document write.

Example chapter field:

```json
{
  "id": "password-reset",
  "commits": ["4f2a9c1", "9d0be7a1c2f34d5e6f708192a3b4c5d6e7f80912"]
}
```

Record the change in `activity` when a commit is linked or removed, for example
`Linked commit 4f2a9c1` or `Removed commit 4f2a9c1`.

## Attachments

Attachments belong to the project document and are shared by all of its
chapters. They are a separate collection, not part of the chapter tree or the
document revision. Uploading or deleting an attachment does not invalidate a
document ETag.

Allowed types and limits:

- `.pdf`, `.csv`, `.tsv`, `.txt`, `.md`, `.log`, `.json`, `.yaml`, `.yml`,
  `.toon`, `.jpg`, `.jpeg`, `.png`, `.xls`, `.xlsx`, `.docx`, `.pptx`;
- at most 10 MiB (10 × 1024 × 1024 bytes) of decoded content per file;
- at most 20 attachments per project.

Upload with raw base64 JSON, not multipart and not a data-URL prefix:

```sh
BASE64=$(base64 < /tmp/report.pdf | tr -d '\n')
curl -sS $AUTH \
  -X POST "http://127.0.0.1:3001/api/v1/projects/$PROJECT_ID/attachments" \
  -H 'Content-Type: application/json' \
  -d "{\"filename\":\"report.pdf\",\"contentBase64\":\"$BASE64\"}"
```

List, read metadata, download and delete:

```sh
curl -sS $AUTH \
  "http://127.0.0.1:3001/api/v1/projects/$PROJECT_ID/attachments"
curl -sS $AUTH \
  "http://127.0.0.1:3001/api/v1/projects/$PROJECT_ID/attachments/$ATTACHMENT_ID"
curl -sS $AUTH -OJ \
  "http://127.0.0.1:3001/api/v1/projects/$PROJECT_ID/attachments/$ATTACHMENT_ID/content"
curl -sS $AUTH -X DELETE \
  "http://127.0.0.1:3001/api/v1/projects/$PROJECT_ID/attachments/$ATTACHMENT_ID"
```

The extension selects the content type. The server also checks PDF, image and
OLE signatures, requires valid UTF-8 text without NUL bytes for text formats, and
checks the required package entry for `.xlsx`, `.docx` and `.pptx`. Mismatches
are rejected. Downloads are served with
`Content-Disposition: attachment`, `X-Content-Type-Options: nosniff` and
`Cache-Control: no-store`; never render attachment bytes inline. Attachment
changes appear in activity as `Attached <name>` and `Removed <name>`.
Duplicating a project copies its attachments. Export/import does not include
attachment content.

Do not invent attachment ids or filenames. Ask before deleting an attachment.
Never upload a file you have not been given.

## Search

Use search to find a chapter before reading it. Search is always scoped to one
project:

```sh
curl -sS $AUTH \
  "http://127.0.0.1:3001/api/v1/projects/$PROJECT_ID/search?q=reset%20email"
```

Rules:

- `q` is required and must be 2–200 characters after trimming;
- search covers chapter titles, descriptions, criterion text, commit hashes and
  all three verification texts;
- activity, project metadata, test guidelines and ids are not searched;
- every whitespace-separated term must match somewhere in the same chapter;
- matching is case-insensitive substring matching, with no fuzzy matching,
  regex or query language;
- a term of 4–40 hexadecimal characters matches commit hashes by prefix;
- results are chapter-level and ranked by exact commit, commit prefix, title,
  criterion, description, then verification text;
- `limit` defaults to 20 and is capped at 100; use `offset` for later pages;
- the response includes `documentRevision`; search does not return an ETag and
  does not change the document.

Read the matched chapter with `get_document` before editing it. Search results
reflect the latest saved document, not unsaved browser changes.

## Verification and coverage

Verification rules belong to chapters, not criteria.

- `auto`: one full command, such as `npm test login:test-ok`.
- `human`: plain instructions for a person.
- `ai`: plain instructions for an AI verifier.

Coverage is declaration-based:

- only non-root chapters are eligible;
- only `auto` chapters with a non-empty command count as covered;
- Human, AI and empty Auto-test chapters count as uncovered context;
- the API does not execute commands or record test results;
- coverage rows include the chapter's `commits` array.

Read coverage with:

```sh
curl -sS $AUTH \
  "http://127.0.0.1:3001/api/v1/projects/$PROJECT_ID/coverage"
```

Use the `coverage` endpoint for an agent-oriented summary. The React UI derives
the same values from the loaded document.

## Export and import

Export before risky bulk changes:

```sh
curl -sS $AUTH -o "/tmp/layers-$PROJECT_ID.json" \
  "http://127.0.0.1:3001/api/v1/projects/$PROJECT_ID/export"
```

Every exported file contains a top-level `instructions` string that explains
the format and how to read it. Read that field first. Import always creates a
new project; it never overwrites or merges:

```sh
curl -sS $AUTH -X POST http://127.0.0.1:3001/api/v1/projects/import \
  -H 'Content-Type: application/json' \
  --data @/tmp/layers-project.json
```

Name collisions get an `(imported)` suffix.

## Error handling

Errors use:

```json
{
  "error": {
    "code": "revision_conflict",
    "message": "The document changed since it was loaded.",
    "details": { "currentRevision": 13 }
  }
}
```

Branch on `error.code`, not only the HTTP status.

Common codes:

- `unauthenticated`
- `invalid_credentials`
- `account_disabled`
- `forbidden`
- `invalid_origin`
- `not_found`
- `validation_failed`
- `revision_conflict`
- `precondition_required`
- `email_taken`
- `rate_limited`
- `project_limit`
- `attachment_limit_reached`
- `attachment_too_large`
- `attachment_not_found`
- `unsupported_attachment_type`
- `payload_too_large`
- `stored_data_invalid`
- `database_unavailable`
- `internal_error`

If validation fails, read `details` and fix the request. Do not strip fields from
the document just to make validation pass.

## Before changing the code

If the task is to change the product rather than edit documentation:

- Keep the API contract, Zod schemas and OpenAPI document in sync.
- Regenerate types with `npm run api:types`.
- Update API integration and contract tests.
- Update Playwright tests for UI behaviour changes.
- Keep the shared domain rules in `src/domain` as the single implementation.
- Do not reintroduce browser `localStorage` persistence.
- Do not weaken authentication, session handling or project ownership checks.
- Do not add remote exposure, Postgres support or collaboration unless the task
  explicitly asks for it.

Relevant files:

```text
server/api/openapi.yaml       API contract
server/api/schemas.ts         runtime validation
server/api/routes/            route handlers
server/auth/                  password, project keys, OAuth tokens and guards
server/oauth/                 OAuth discovery, consent, token and revoke handlers
server/db/store.ts            SQLite project queries and transactions
server/db/authStore.ts        users, sessions and project API keys
server/db/oauthStore.ts       OAuth clients, requests, codes and grants
server/db/bootstrap.ts        super-admin and ownership bootstrap
server/db/migrations/         schema migrations
src/domain/                   shared domain rules
src/api/                      browser API client
src/store/                    auth and workspace React providers
docs/api.md                   agent/curl guide
```

## Tests

Run only what is needed for the task, then run the broader gate before handing
work back.

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

Notes:

- `npm run test:e2e` starts the API and UI with a dedicated
  `test-results/e2e.sqlite` database and resets it before each test.
- The guarded `POST /api/v1/test/reset` endpoint exists only when
  `LAYERS_TEST_MODE=1`. Never use it against a person's normal database.
- Production smoke tests use a temporary database under `test-results/`.
- If tests fail because the API is not running, check `npm run dev` before
  changing code.

## Reporting back

When you finish, report:

- which project and chapters you changed;
- what changed and why;
- the resulting document revision or activity entries, when relevant;
- any validation, conflict or test results;
- anything you did not change because it needed confirmation.

Keep the report concise and factual.

## Remote MCP access

When connected through the Layers MCP server, use its project and document
tools instead of the REST examples above. The server sends adapted instructions
during initialization. The credential is bound to one project: `list_projects`
returns only that project, and every other tool requires its project id.
`search_project` uses the same project-scoped rules as the REST search endpoint;
read a matched chapter with `get_document` before editing it. Attachment tools
are `list_attachments`, `get_attachment`, `add_attachment` and
`delete_attachment`; they use the same 20-file and 10 MiB limits. `get_attachment`
returns metadata plus base64 content, and `add_attachment` accepts raw base64. It
cannot create, import, duplicate or activate projects. A read-only credential
can read; a read-write credential can edit. Project metadata and document writes require their
respective ETags; reread and rebase on a conflict. See `docs/api.md` for Codex
configuration, HTTPS requirements and limits. Ask before destructive changes.

The MCP instructions model a project as a chapter tree with success criteria:
adding a criterion to a non-final chapter creates its subchapter on the backend.
Before writing, the agent offers two planning modes — a whole-project
discussion that it turns into all detailed criteria, or an interactive
criterion-by-criterion walk — and does not pick one on the user's behalf.
