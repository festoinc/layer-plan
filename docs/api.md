# Layers local API

The API is a local, unauthenticated HTTP service for the Layers React client
and local AI agents. It binds to `127.0.0.1:3001` by default and stores data in
a SQLite file (`data/layers.sqlite` unless `LAYERS_DB_PATH` is set).

- Base URL: `http://127.0.0.1:3001/api/v1`
- OpenAPI document: `server/api/openapi.yaml`
- Interactive docs: `http://127.0.0.1:3001/api/v1/docs`
- JSON contract: `http://127.0.0.1:3001/api/v1/openapi.json`

There is no authentication. Do not expose the API beyond loopback unless you
understand that any local process or browser origin could read and modify the
data. For broader AI-agent working instructions, see
[`AGENTS_template.md`](../AGENTS_template.md).

## Common flows

### List projects

```sh
curl http://127.0.0.1:3001/api/v1/projects
```

Response:

```json
{
  "projects": [
    {
      "id": "website",
      "name": "Website project",
      "initials": "W",
      "color": "indigo",
      "description": "Customer-facing website and account flows.",
      "createdAt": "2026-11-11T18:00:00.000Z",
      "updatedAt": "2026-11-11T18:00:00.000Z",
      "chapterCount": 6,
      "criterionCount": 18,
      "checkedCount": 2
    }
  ],
  "activeProjectId": "website"
}
```

### Read a project and its document

```sh
curl -D /tmp/project.headers http://127.0.0.1:3001/api/v1/projects/website
curl -D /tmp/document.headers \
  http://127.0.0.1:3001/api/v1/projects/website/document
```

Save the `ETag` header from the document response. It is the revision required
by the next write.

### Replace a document

`PUT` requires `If-Match`. A stale revision returns
`412 Precondition Failed` with `error.code = "revision_conflict"`.

```sh
REVISION=$(awk 'tolower($1) == "etag:" { gsub(/"/, "", $2); print $2 }' \
  /tmp/document.headers)

curl -X PUT http://127.0.0.1:3001/api/v1/projects/website/document \
  -H 'Content-Type: application/json' \
  -H "If-Match: \"$REVISION\"" \
  --data @/tmp/document-body.json
```

The request body is:

```json
{
  "chapters": { "byId": {}, "rootIds": [] },
  "selectedId": "password-reset",
  "activity": [
    {
      "id": "event-1",
      "message": "Updated the reset flow",
      "chapterId": "password-reset",
      "chapterName": "Password reset"
    }
  ]
}
```

`activity` is optional and should contain only new entries. The server assigns
timestamps, ignores duplicate `(projectId, eventId)` pairs and keeps the newest
100 entries.

The response contains the saved document, `stats`, and the latest `activity`.
Use the new `ETag` for the next write.

### Append activity

```sh
curl -X POST http://127.0.0.1:3001/api/v1/projects/website/activity \
  -H 'Content-Type: application/json' \
  -d '{"message":"Reviewed AI verification instructions","chapterId":null,"chapterName":"Website project"}'
```

### Coverage

```sh
curl http://127.0.0.1:3001/api/v1/projects/website/coverage
```

### Export and import

```sh
curl -o layers-website.json \
  http://127.0.0.1:3001/api/v1/projects/website/export

curl -X POST http://127.0.0.1:3001/api/v1/projects/import \
  -H 'Content-Type: application/json' \
  --data @layers-website.json
```

The export includes a top-level `instructions` string that explains the file
format and how to read it. Read that field before interpreting the rest of the
file. Imports always create a new project and never overwrite an existing one.

## Revision rules

| Resource                        | Header     | Used by                                       |
| ------------------------------- | ---------- | --------------------------------------------- |
| Project metadata and guidelines | `If-Match` | `PATCH /projects/:id`, `DELETE /projects/:id` |
| Project document                | `If-Match` | `PUT /projects/:id/document`                  |

ETags are quoted decimal revisions such as `"12"`. Missing headers return
`428 precondition_required`; stale headers return `412 revision_conflict`.

## Errors

```json
{
  "error": {
    "code": "revision_conflict",
    "message": "The document changed since it was loaded.",
    "details": { "currentRevision": 13 }
  }
}
```

Common codes: `not_found`, `validation_failed`, `revision_conflict`,
`precondition_required`, `project_limit`, `payload_too_large`,
`stored_data_invalid`, `database_unavailable`, `internal_error`.
