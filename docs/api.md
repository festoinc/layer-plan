# Layers local API

The API is a local, authenticated HTTP service for the Layers React client and
local AI agents. It binds to `127.0.0.1:3001` by default and stores data in a
SQLite file (`data/layers.sqlite` unless `LAYERS_DB_PATH` is set).

- Base URL: `http://127.0.0.1:3001/api/v1`
- OpenAPI document: `server/api/openapi.yaml`
- Interactive docs: `http://127.0.0.1:3001/api/v1/docs`
- JSON contract: `http://127.0.0.1:3001/api/v1/openapi.json`

Every project is private to its owner. Browser clients use an `HttpOnly` session
cookie; local AI agents use bearer API tokens. For broader AI-agent working
instructions, see [`AGENTS_template.md`](../AGENTS_template.md).

## Sign in

The super admin is configured in `.env` and can create member accounts at
`#/users`. No email is sent. Passwords cannot be changed or recovered yet.

```sh
curl -c /tmp/layers-cookies.txt \
  -X POST http://127.0.0.1:3001/api/v1/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"admin@example.com","password":"your-password"}'
```

The response includes the current user and session. The cookie jar now holds
`layers_session`. Use `-b /tmp/layers-cookies.txt` for browser-style calls.

```sh
curl -b /tmp/layers-cookies.txt \
  http://127.0.0.1:3001/api/v1/auth/session
```

Sign out:

```sh
curl -b /tmp/layers-cookies.txt -X POST \
  http://127.0.0.1:3001/api/v1/auth/logout
```

## Create an API token for an agent

Sign in as the user the agent should act for, then create a token. The secret is
returned once and cannot be shown again.

```sh
curl -b /tmp/layers-cookies.txt \
  -X POST http://127.0.0.1:3001/api/v1/me/tokens \
  -H 'Content-Type: application/json' \
  -d '{"name":"Local coding agent","scopes":["read","write"]}'
```

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

Use the token directly:

```sh
export LAYERS_API_TOKEN=lrs_...
curl -H "Authorization: Bearer $LAYERS_API_TOKEN" \
  http://127.0.0.1:3001/api/v1/projects
```

`read` allows `GET`/`HEAD`. `write` allows mutations and implies `read`. Tokens
cannot manage users, sessions or other tokens; those operations require a
browser session. List and revoke tokens with `GET /me/tokens` and
`DELETE /me/tokens/{id}`.

## Common flows

The examples below use `$AUTH`, which is either:

```sh
AUTH="Authorization: Bearer $LAYERS_API_TOKEN"
```

or a cookie jar:

```sh
AUTH=""
# add -b /tmp/layers-cookies.txt to each curl command
```

### List projects

```sh
curl -H "$AUTH" http://127.0.0.1:3001/api/v1/projects
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

The list contains only the authenticated user's projects. Another user's
project id returns `404`.

### Read a project and its document

```sh
curl -H "$AUTH" -D /tmp/project.headers \
  http://127.0.0.1:3001/api/v1/projects/website
curl -H "$AUTH" -D /tmp/document.headers \
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

curl -H "$AUTH" \
  -X PUT http://127.0.0.1:3001/api/v1/projects/website/document \
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
timestamps, ignores duplicate `(projectId, eventId)` pairs, records the acting
user and keeps the newest 100 entries.

The response contains the saved document, `stats`, and the latest `activity`.
Use the new `ETag` for the next write.

### Commit references

Each chapter has a `commits` array. It records the git commits that implemented
the document, newest first. It is informational: linking or removing a commit
never changes criteria or verification.

```json
{
  "id": "password-reset",
  "commits": ["4f2a9c1", "9d0be7a1c2f34d5e6f708192a3b4c5d6e7f80912"]
}
```

Rules:

- hashes are 7–40 hexadecimal characters, case-insensitive on input and stored
  lowercase;
- missing `commits` is accepted and normalized to `[]`;
- invalid hashes return `422 validation_failed`;
- duplicates are removed and the list is capped at 50;
- links are manual; the API never contacts a git repository or host.

Send commit changes with the normal full-document `PUT`. Include a matching
activity entry if the change should appear on the activity page:

```json
{
  "chapters": { "byId": {}, "rootIds": [] },
  "selectedId": "password-reset",
  "activity": [
    {
      "id": "event-commit-1",
      "message": "Linked commit 4f2a9c1",
      "chapterId": "password-reset",
      "chapterName": "Password reset"
    }
  ]
}
```

### Append activity

```sh
curl -H "$AUTH" \
  -X POST http://127.0.0.1:3001/api/v1/projects/website/activity \
  -H 'Content-Type: application/json' \
  -d '{"message":"Reviewed AI verification instructions","chapterId":null,"chapterName":"Website project"}'
```

Activity entries include `actorUserId` and `actorName` when they were created
after phase 6.

### Coverage

```sh
curl -H "$AUTH" \
  http://127.0.0.1:3001/api/v1/projects/website/coverage
```

Each coverage row includes the chapter's `commits` array in addition to the
verification mode and criterion counts.

### Export and import

```sh
curl -H "$AUTH" -o layers-website.json \
  http://127.0.0.1:3001/api/v1/projects/website/export

curl -H "$AUTH" \
  -X POST http://127.0.0.1:3001/api/v1/projects/import \
  -H 'Content-Type: application/json' \
  --data @layers-website.json
```

The export includes a top-level `instructions` string that explains the file
format and how to read it. Read that field before interpreting the rest of the
file. Exports use `layers-project` format version 4 and include each chapter's
`commits`; version 3 files without commits still import with empty lists.
Imports always create a new project, never overwrite an existing one, and assign
the importing user as owner. Actor fields are not included in exports.

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

Common codes: `unauthenticated`, `invalid_credentials`, `account_disabled`,
`forbidden`, `invalid_origin`, `not_found`, `validation_failed`,
`revision_conflict`, `precondition_required`, `email_taken`, `rate_limited`,
`project_limit`, `payload_too_large`, `stored_data_invalid`,
`database_unavailable`, `internal_error`.

`401 unauthenticated` means the session or token is missing, expired or revoked.
Sign in again or create a new token. Do not retry a `401` in a loop.

## Remote Codex MCP access

The app serves a stateless MCP endpoint at `/mcp` in the same process as the API.
It exposes project and document operations; account, user, session, and token
administration are not MCP tools. Calls use the existing API authorization and
revision rules. The server supplies agent instructions on initialization.

1. Sign in to Layers and create an API token on `#/account`. Choose read-only
   for inspection or read-write for edits. Never send a token in chat.
2. Set `LAYERS_MCP_ALLOWED_HOSTS` in the server environment to a comma-separated
   list of permitted hostnames, for example `layers.example.com,localhost`.
   Ports are omitted. The default permits only `localhost`, `127.0.0.1`, and
   `[::1]`. If browser-based MCP clients are used, their exact origin must also
   be configured through `LAYERS_UI_ORIGIN`; Codex does not need an Origin.
3. Put the app behind an HTTPS reverse proxy that preserves the original Host
   header and supports Streamable HTTP. Keep the plain HTTP port private. The
   included Compose file publishes on all interfaces by default; override its
   port binding to `127.0.0.1:3001:3001` (or another unused loopback port) when
   the proxy runs on the same host. Restrict access to the proxy's backend on
   other deployments. Disable logging of Authorization headers. Do not use a
   real token over public HTTP.
4. On the machine running Codex, make the token available to the Codex process:

   ```sh
   export LAYERS_API_TOKEN='<token created in Layers>'
   codex mcp add layers --url https://<domain>/mcp --bearer-token-env-var LAYERS_API_TOKEN
   codex mcp list
   ```

A user's token is checked on each request; revoking it on the account page
blocks future requests. Never place tokens in URLs or commit them to files.
Project and document updates use separate ETags, exposed in tool results. On a
revision conflict, fetch the latest content and reapply the intended change.
MCP requests and responses are limited to 2 MiB; larger documents must be
handled through the existing API. The agent is instructed to seek confirmation
before destructive actions, but this is not a server-side approval guarantee.
