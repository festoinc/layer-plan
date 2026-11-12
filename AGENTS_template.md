# AGENTS template — Layers project documentation

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
- create or edit chapters, descriptions, success criteria and verification
  rules through the Layers API;
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

The API is local-only and has no authentication. Do not expose it beyond
loopback. Do not change `HOST` to a public interface unless the person
explicitly asks for that and understands the security implications.

The API is the source of truth. Do not edit SQLite directly, do not use
browser `localStorage`, and do not modify files under `data/` while the API is
running.

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

| Method   | Path                      | Purpose                          |
| -------- | ------------------------- | -------------------------------- |
| `GET`    | `/projects`               | List projects and active project |
| `POST`   | `/projects`               | Create a project                 |
| `GET`    | `/projects/:id`           | Read metadata and guidelines     |
| `PATCH`  | `/projects/:id`           | Update metadata or guidelines    |
| `DELETE` | `/projects/:id`           | Delete a project                 |
| `POST`   | `/projects/:id/duplicate` | Duplicate a project              |
| `POST`   | `/projects/:id/activate`  | Set the active project           |
| `GET`    | `/projects/:id/document`  | Read the document                |
| `PUT`    | `/projects/:id/document`  | Replace the document             |
| `GET`    | `/projects/:id/activity`  | Read activity                    |
| `POST`   | `/projects/:id/activity`  | Append an activity entry         |
| `GET`    | `/projects/:id/coverage`  | Read verification coverage       |
| `GET`    | `/projects/:id/export`    | Download a project file          |
| `POST`   | `/projects/import`        | Import a project file            |

See `server/api/openapi.yaml` for exact request and response schemas. When the
contract and an old example disagree, the OpenAPI document wins.

## Read before writing

1. List projects:

```sh
curl -sS http://127.0.0.1:3001/api/v1/projects
```

2. Read the project and its document. Save the document `ETag`:

```sh
PROJECT_ID=website

curl -sS -D /tmp/layers-project.headers \
  "http://127.0.0.1:3001/api/v1/projects/$PROJECT_ID"

curl -sS -D /tmp/layers-document.headers \
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
  "schemaVersion": 6,
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
- Every chapter has `parentId`, `childIds`, `criteria` and `verification`.
- Every criterion has `id`, `text` and `checked`.
- A criterion may have `chapterId` when it created a subchapter. Keep that link
  consistent.
- `verification.mode` is exactly `auto`, `human` or `ai`.
- Each mode keeps its own text, even when inactive.
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
curl -sS -X PUT \
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
curl -sS -X POST \
  "http://127.0.0.1:3001/api/v1/projects/$PROJECT_ID/activity" \
  -H 'Content-Type: application/json' \
  -d '{"message":"Reviewed AI verification instructions","chapterId":null,"chapterName":"Website project"}'
```

Do not attempt to edit or delete activity. There is no endpoint for that.

## Verification and coverage

Verification rules belong to chapters, not criteria.

- `auto`: one full command, such as `npm test login:test-ok`.
- `human`: plain instructions for a person.
- `ai`: plain instructions for an AI verifier.

Coverage is declaration-based:

- only non-root chapters are eligible;
- only `auto` chapters with a non-empty command count as covered;
- Human, AI and empty Auto-test chapters count as uncovered context;
- the API does not execute commands or record test results.

Read coverage with:

```sh
curl -sS "http://127.0.0.1:3001/api/v1/projects/$PROJECT_ID/coverage"
```

Use the `coverage` endpoint for an agent-oriented summary. The React UI derives
the same values from the loaded document.

## Export and import

Export before risky bulk changes:

```sh
curl -sS -o "/tmp/layers-$PROJECT_ID.json" \
  "http://127.0.0.1:3001/api/v1/projects/$PROJECT_ID/export"
```

Every exported file contains a top-level `instructions` string that explains
the format and how to read it. Read that field first. Import always creates a
new project; it never overwrites or merges:

```sh
curl -sS -X POST http://127.0.0.1:3001/api/v1/projects/import \
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

- `not_found`
- `validation_failed`
- `revision_conflict`
- `precondition_required`
- `project_limit`
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
- Do not add authentication, remote exposure or Postgres support unless the
  task explicitly asks for it.

Relevant files:

```text
server/api/openapi.yaml       API contract
server/api/schemas.ts         runtime validation
server/api/routes/            route handlers
server/db/store.ts            SQLite queries and transactions
server/db/migrations/         schema migrations
src/domain/                   shared domain rules
src/api/                      browser API client
src/store/                    React providers
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
