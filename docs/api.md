# Layers local API

The API is a local, authenticated HTTP service for the Layers React client and
local AI agents. It binds to `127.0.0.1:3001` by default and stores data in a
SQLite file (`data/layers.sqlite` unless `LAYERS_DB_PATH` is set).

- Base URL: `http://127.0.0.1:3001/api/v1`
- OpenAPI document: `server/api/openapi.yaml`
- Interactive docs: `http://127.0.0.1:3001/api/v1/docs`
- JSON contract: `http://127.0.0.1:3001/api/v1/openapi.json`

Every project is private to its owner. Browser clients use an `HttpOnly` session
cookie. MCP clients use either a project API key or an OAuth access token; both
are accepted only by `/mcp`. For AI-agent working instructions, see
[`LAYERS_AGENT_GUIDE.md`](../LAYERS_AGENT_GUIDE.md).

## Sign in

The super admin is configured in `.env` and can create member accounts at
`#/users`. No email is sent. The super admin can change their own password at
`#/account`; member passwords and password recovery are not available.

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

## Change the super-admin password

Sign in and send the current password with the new password. The new password
must be 12–200 characters and must differ from the current one. The current
session stays signed in; other browser sessions are revoked.

```sh
curl -b /tmp/layers-cookies.txt \
  -X POST http://127.0.0.1:3001/api/v1/me/password \
  -H 'Content-Type: application/json' \
  -d '{"currentPassword":"current-password","newPassword":"new-password-123"}'
```

The response is `204 No Content`. A wrong current password returns
`403 invalid_credentials` without signing out the current session. Member
sessions and project API keys cannot call this endpoint. The account page form asks for the new password twice and checks the
values before sending.

## Create an MCP API key for a project

An MCP client that accepts a bearer token needs an API key bound to one project.
Keys are accepted only by `/mcp`; they cannot call the REST API. Create keys
from the project actions menu (**MCP access**) or with a browser session:

```sh
curl -b /tmp/layers-cookies.txt \
  -X POST http://127.0.0.1:3001/api/v1/projects/website/tokens \
  -H 'Content-Type: application/json' \
  -d '{"name":"Codex on my laptop"}'
```

```json
{
  "token": "lrs_...",
  "tokenInfo": {
    "id": "tok_...",
    "projectId": "website",
    "name": "Codex on my laptop",
    "prefix": "lrs_abcd",
    "scopes": ["read", "write"],
    "createdAt": "2026-11-16T10:30:00.000Z",
    "lastUsedAt": null,
    "expiresAt": "2035-12-30T10:30:00.000Z",
    "revokedAt": null
  }
}
```

The secret is returned once and cannot be shown again. `scopes` defaults to
`["read", "write"]`; omit it for read-only inspection. `expiresInDays` defaults
to `3650` and must be between 1 and 3650. A person can have at most 20 active
keys across all projects. Project deletion deletes the project's keys.

List and revoke keys with:

```sh
curl -b /tmp/layers-cookies.txt \
  http://127.0.0.1:3001/api/v1/projects/website/tokens

curl -b /tmp/layers-cookies.txt -X DELETE \
  http://127.0.0.1:3001/api/v1/projects/website/tokens/<tokenId>
```

Key management requires a browser session. A project key cannot manage users,
sessions, keys or other projects. A valid key sent to a REST endpoint returns
`403 forbidden`.

## Common flows

The examples below use a browser session cookie:

```sh
AUTH="-b /tmp/layers-cookies.txt"
```

### List projects

```sh
curl $AUTH http://127.0.0.1:3001/api/v1/projects
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
curl $AUTH -D /tmp/project.headers \
  http://127.0.0.1:3001/api/v1/projects/website
curl $AUTH -D /tmp/document.headers \
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

curl $AUTH \
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

The response contains the saved document, `stats`, the latest `activity`,
`createdSubchapters` and `criterionSync`. The backend creates a subchapter for
each new criterion on a non-final chapter and returns its id, parent id,
criterion id and derived title. Use the returned `chapters` and
`createdSubchapters` as the new working copy; do not create the subchapter
yourself. Existing criteria are not backfilled, and final-level chapters,
already-linked criteria and empty criterion text are skipped.

A success criterion with `chapterId` and the subchapter it names are one
synchronized pair. The criterion text is the canonical Markdown: the subchapter
`description` is the same string and its `title` is derived from the first line.
The backend keeps the pair identical on every write:

- changing the criterion text updates the subchapter title and description;
- changing only the subchapter description updates the criterion text;
- changing only the subchapter title replaces the first line of the criterion
  text and keeps the remaining lines;
- if both sides changed in one write, the criterion text wins;
- deleting a criterion deletes the subchapter and its whole subtree;
- deleting the subchapter deletes the criterion;
- removing only `chapterId` detaches the pair: the criterion and the chapter
  both survive and the chapter becomes an ordinary manual chapter. Detaching and
  deleting the criterion in one write is not a detach; the backend deletes the
  chapter. Save the detach first, then delete the criterion;
- a chapter that is moved out of its criterion's chapter is detached, not
  deleted;
- a new criterion that already names an existing chapter adopts the criterion
  text as canonical and overwrites that chapter's title and description.

`criterionSync` reports what the backend changed and always contains three
arrays: `updatedSubchapters` (`id`, `parentId`, `criterionId`, `title`,
`description`), `removedSubchapters` (`id`, `parentId`, `criterionId`, `title`)
and `removedCriteria` (`chapterId`, `criterionId`, `text`). A request that
already matched the stored document returns empty arrays and does not bump the
revision. When the backend deletes a subchapter it also appends a
`Deleted subchapter from success criterion` activity entry.

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

### Attachments

Attachments belong to the project document, not to an individual chapter.
Allowed files are `.pdf`, `.csv`, `.tsv`, `.txt`, `.md`, `.log`, `.json`,
`.yaml`, `.yml`, `.toon`, `.jpg`, `.jpeg`, `.png`, `.xls`, `.xlsx`, `.docx` and
`.pptx`. Each file can be at most 10 MiB (10 × 1024 × 1024 bytes) of decoded
content, and a project can have at most 20 attachments. Upload and delete do not
change the document or metadata revision.

Upload uses JSON with raw base64 content, not multipart and not a data-URL
prefix:

```sh
BASE64=$(base64 < /tmp/report.pdf | tr -d '\n')
curl $AUTH \
  -X POST http://127.0.0.1:3001/api/v1/projects/website/attachments \
  -H 'Content-Type: application/json' \
  -d "{\"filename\":\"report.pdf\",\"contentBase64\":\"$BASE64\"}"
```

Response `201`:

```json
{
  "id": "att_...",
  "projectId": "website",
  "filename": "report.pdf",
  "contentType": "application/pdf",
  "sizeBytes": 48213,
  "sha256": "9f2c...",
  "createdAt": "2026-11-17T10:00:00.000Z",
  "createdByName": "Super Admin"
}
```

List and limits:

```sh
curl $AUTH http://127.0.0.1:3001/api/v1/projects/website/attachments
```

```json
{
  "attachments": [],
  "maxAttachments": 20,
  "maxAttachmentBytes": 10485760,
  "allowedExtensions": [
    ".pdf",
    ".csv",
    ".tsv",
    ".txt",
    ".md",
    ".log",
    ".json",
    ".yaml",
    ".yml",
    ".toon",
    ".jpg",
    ".jpeg",
    ".png",
    ".xls",
    ".xlsx",
    ".docx",
    ".pptx"
  ]
}
```

Read metadata, download content and delete:

```sh
curl $AUTH \
  http://127.0.0.1:3001/api/v1/projects/website/attachments/<attachmentId>

curl $AUTH -OJ \
  http://127.0.0.1:3001/api/v1/projects/website/attachments/<attachmentId>/content

curl $AUTH -X DELETE \
  http://127.0.0.1:3001/api/v1/projects/website/attachments/<attachmentId>
```

The extension selects the content type. The server checks image/PDF/OLE
signatures, requires valid UTF-8 text without NUL bytes for text formats, and
checks the required package entry for `.xlsx`, `.docx` and `.pptx`. A mismatch
returns `415 unsupported_attachment_type`. Upload errors
use `413 attachment_too_large`, `409 attachment_limit_reached` and
`422 validation_failed`. Missing attachments return
`404 attachment_not_found`. Downloads set `Content-Disposition: attachment`,
`X-Content-Type-Options: nosniff` and `Cache-Control: no-store`; never render
the bytes inline.

Activity records `Attached <filename>` and `Removed <filename>`. Duplicating a
project copies its attachments. The JSON export does not include attachment
content, and importing a project does not restore attachments.

### Search a project

Search is always scoped to one project. There is no global search endpoint.

```sh
curl $AUTH \
  "http://127.0.0.1:3001/api/v1/projects/website/search?q=reset%20email&limit=20"
```

`q` is required and must be 2–200 characters after trimming. `limit` defaults
to 20 and is capped at 100; `offset` defaults to 0 and paginates the ranked
results.

Search covers chapter titles, descriptions, criterion text, commit hashes and
the Auto-test, Human and AI verification text. It does not search activity,
project metadata, test guidelines or ids. Matching is case-insensitive
substring matching: every whitespace-separated term must appear somewhere in the
same chapter. A query term of 4–40 hexadecimal characters also matches commit
hashes by prefix. There is no fuzzy matching, regex or query language.

Results are chapter-level and ranked by match type: exact commit, commit prefix,
title, criterion, description, then verification text. Each result contains the
chapter path, up to five plain-text snippets and highlight ranges:

```json
{
  "projectId": "website",
  "query": "reset email",
  "documentRevision": 4,
  "total": 2,
  "offset": 0,
  "limit": 20,
  "truncated": false,
  "results": [
    {
      "chapterId": "password-reset",
      "title": "Password reset",
      "path": [
        { "id": "authentication", "title": "Authentication" },
        { "id": "password-reset", "title": "Password reset" }
      ],
      "matchCount": 3,
      "matches": [
        {
          "field": "criterion",
          "criterionId": "reset-1",
          "snippet": "A user can request a password reset by email",
          "ranges": [
            [30, 35],
            [39, 44]
          ]
        }
      ]
    }
  ]
}
```

`documentRevision` tells you which saved document snapshot was searched. Search
does not return an ETag and does not change the document or activity. Missing
or another user's project returns `404`; invalid parameters return `422`;
responses use `Cache-Control: no-store`.

### Append activity

```sh
curl $AUTH \
  -X POST http://127.0.0.1:3001/api/v1/projects/website/activity \
  -H 'Content-Type: application/json' \
  -d '{"message":"Reviewed AI verification instructions","chapterId":null,"chapterName":"Website project"}'
```

Activity entries include `actorUserId` and `actorName` when they were created
after phase 6.

### Coverage

```sh
curl $AUTH \
  http://127.0.0.1:3001/api/v1/projects/website/coverage
```

Each coverage row includes the chapter's `commits` array in addition to the
verification mode and criterion counts.

### Export and import

```sh
curl $AUTH -o layers-website.json \
  http://127.0.0.1:3001/api/v1/projects/website/export

curl $AUTH \
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
`project_limit`, `attachment_limit_reached`, `attachment_too_large`,
`attachment_not_found`, `unsupported_attachment_type`, `password_unchanged`,
`payload_too_large`, `stored_data_invalid`, `database_unavailable`,
`internal_error`.

`401 unauthenticated` means the session, MCP key or OAuth access token is
missing, expired or revoked. Sign in again, create a new key, or let the MCP
client refresh or repeat its OAuth authorization. Do not retry a `401` in a
loop.

## MCP OAuth authorization

OAuth-only MCP clients use the same `/mcp` endpoint. Layers acts as both the
OAuth 2.1 authorization server and the MCP resource server in the existing API
process. An MCP request is authenticated by either a project API key
(`lrs_…`) or an OAuth access token (`loa_…`); the credential type does not
change the fifteen MCP tools or their project binding.

OAuth is enabled only when `LAYERS_PUBLIC_URL` is set. API keys continue to work
without it. The value must be the exact public origin users open, for example
`https://layers.example.com`; plain HTTP is accepted only for loopback
development. It must not contain a path, query or fragment. Restart the server
after changing it.

### Discovery

| Method | Path                                        | Purpose                             |
| ------ | ------------------------------------------- | ----------------------------------- |
| `GET`  | `/.well-known/oauth-protected-resource`     | MCP resource metadata               |
| `GET`  | `/.well-known/oauth-protected-resource/mcp` | Endpoint-specific resource metadata |
| `GET`  | `/.well-known/oauth-authorization-server`   | Authorization-server metadata       |

A `401` from `/mcp` advertises the metadata URL and supported scopes:

```http
WWW-Authenticate: Bearer resource_metadata="https://layers.example.com/.well-known/oauth-protected-resource", scope="read write"
```

The authorization server advertises `authorization_code` and `refresh_token`
grants, `S256` PKCE, and `none`, `client_secret_post` and `client_secret_basic`
client authentication.

### Authorization flow

1. The client registers with `POST /oauth/register` (RFC 7591 dynamic client
   registration) and receives a `lcl_…` client id. Registration is open,
   rate-limited and capped; unused clients are pruned. The consent page shows
   the client name and the redirect hostname.
2. The client opens `GET /oauth/authorize` with `response_type=code`,
   `redirect_uri`, `code_challenge`, `code_challenge_method=S256`, optional
   `scope`, optional `state`, and the MCP `resource` (for example
   `https://layers.example.com/mcp`). The server validates the client and exact
   redirect URI, creates a 10-minute pending request, and redirects to the
   Layers consent page.
3. The person signs in if needed, chooses one owned project, and approves
   read-only or read-write access. The browser is redirected to the client with
   a 5-minute single-use authorization code and the original `state`, or with
   `error=access_denied`.
4. The client exchanges the code at `POST /oauth/token` with
   `grant_type=authorization_code`, the client credentials, the exact
   `redirect_uri`, `code_verifier` and the same `resource`. Tokens are opaque:
   an access token valid for one hour and a refresh token valid for 90 days.
5. The client sends `Authorization: Bearer <access_token>` to `/mcp`. Access
   tokens are bound to the project, scopes and MCP audience chosen at consent.
6. `grant_type=refresh_token` rotates both tokens. Reusing an old refresh token
   revokes the connection. `POST /oauth/revoke` revokes a connection from the
   client, and the project **MCP access** dialog can revoke it from Layers.

Scopes are `read` and `write`; `write` includes `read`. The consent page cannot
grant more than the client requested. A read-only token can call read tools but
receives the existing MCP `403` envelope for writes. If an access token expires,
the client should refresh it; if the refresh token is expired or revoked, the
person must authorize the client again.

Dynamic client registration is the supported client-registration method in this
version. Client ID Metadata Documents are not fetched. An OAuth connection is
always bound to one project; account-wide OAuth access is not available.

### Manage OAuth connections

The project actions menu (**MCP access**) lists API keys and connected apps.
Revoking a connected app invalidates its access and refresh tokens immediately.

| Method   | Path                                                  | Credential | Purpose                |
| -------- | ----------------------------------------------------- | ---------- | ---------------------- |
| `GET`    | `/api/v1/projects/{projectId}/oauth-grants`           | session    | List OAuth connections |
| `DELETE` | `/api/v1/projects/{projectId}/oauth-grants/{grantId}` | session    | Revoke one connection  |

Use HTTPS for any public deployment, set `LAYERS_MCP_ALLOWED_HOSTS`, and keep
the plain HTTP backend private. Ensure the reverse proxy does not cache
`/oauth/*` or `/.well-known/*` and does not log Authorization headers or request
bodies.

## Remote Codex MCP access

The app serves a stateless MCP endpoint at `/mcp` in the same process as the API.
It exposes project and document operations; account, user, session and key
administration are not MCP tools. Calls use the existing API authorization and
revision rules. The server supplies agent instructions on initialization. The
instructions describe the project as a chapter and criterion tree and ask the
agent to offer two ways of working before it writes anything: a whole-project
discussion that the agent turns into all detailed success criteria, or an
interactive walk that agrees one criterion at a time.

1. For a client with a bearer-token field, sign in to Layers, open the project
   actions menu and choose **MCP access**. Create a key for that project. Choose
   read-only for inspection or read-write for edits. Never send the key in chat.
   The key is accepted only by `/mcp`. OAuth-only clients use the flow above
   instead and need no manually created key.
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
   real key over public HTTP.
4. On the machine running Codex, make the key available to the Codex process:

   ```sh
   export LAYERS_API_TOKEN='<project key created in Layers>'
   codex mcp add layers --url https://<domain>/mcp --bearer-token-env-var LAYERS_API_TOKEN
   codex mcp list
   ```

A project key or OAuth access token is checked on each request; revoking it in
the project's **MCP access** dialog, revoking the OAuth connection, deleting the
project, or disabling the user blocks future requests. Never place credentials
in URLs or commit them to files. The credential is bound to one project, so
`list_projects` returns only that project and
`create_project`, `duplicate_project`, `activate_project` and `import_project`
are not available.
Project and document updates use separate ETags, exposed in tool results. When
a document write adds a new criterion to a non-final chapter, the backend
creates the matching subchapter and returns it in `createdSubchapters`. MCP
agents send the criterion without `chapterId` and must not create the
subchapter themselves. The backend also keeps every criterion/subchapter pair
synchronized and reports edits and deletions in `criterionSync`; agents edit the
criterion text (or the subchapter, with the same result) and never try to keep
the two sides different. On a revision conflict, fetch the latest content and
reapply the intended change.
MCP transport requests and responses are limited to 15 MiB so a 10 MiB
attachment fits after base64 encoding. A regular tool envelope above 2 MiB
returns `payload_too_large`; `get_attachment` may return the full attachment
content. The attachment tools are `list_attachments`, `get_attachment`,
`add_attachment` and `delete_attachment`; `add_attachment` takes raw
`contentBase64` and `get_attachment` returns metadata plus `contentBase64`.
The read-only `search_project` tool uses the same project-scoped rules and
returns the same search response. The agent is instructed to seek confirmation
before destructive actions, but instructions are not a server-side approval
guarantee. In a Codex CLI 0.169.0 test, Codex attempted deletion after a direct
request without first asking in chat; the client blocked the tool call because
its approval policy did not allow approval requests. Configure and verify the
client's approval behavior before relying on MCP for writes.
