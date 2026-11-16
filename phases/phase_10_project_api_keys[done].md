# Phase 10 — Project-scoped API keys for MCP

Status: delivered  
Updated: 2026-11-16

## Delivery and verification

- CI `verify` passed on the merge commit, including unit, API, contract, build
  and Playwright suites. The Docker job published `latest` and `sha-6ed8303`
  with the same digest:
  `sha256:6b0f2f5bcb6c5219c5573d809a8cc6684c85ec4e32aec3684238d34050573d9b`.
- The image was deployed on the shared test host with a temporary checkout,
  loopback-only port, temporary super-admin credentials and the test domain's
  existing HTTPS proxy. Root, health, OpenAPI and MCP initialization returned
  `200`; the test reset endpoint returned `404`.
- Raw MCP checks over public HTTPS confirmed the exact ten-tool list, one project
  in `list_projects`, `404` for another project id, a successful document edit,
  a stale-write `412 revision_conflict`, and `403` for the same key on a direct
  REST request. Deleting the bound project through MCP returned `200`; the key
  then returned `401`.
- Codex CLI 0.169.0 connected from the developer machine through the public
  HTTPS endpoint, listed the project, read project metadata and the document,
  and reported revision 2 without modifying anything. It used
  `list_projects`, `get_project` and `get_document`.
- Cleanup removed the test container, volume, network and checkout; test ports
  were free, nginx and the other host services were running, and the untagged
  image created during the pull was removed.
- P-20 remains open: this phase did not run an interactive destructive-approval
  scenario. The raw MCP deletion verified server behavior, not client approval.

## Relationship to phase 9

Phase 9 delivered remote MCP access with account-wide user API tokens. This phase
replaces that credential model with API keys bound to exactly one project. The
MCP endpoint, transport, in-process dispatch, HTTPS requirements and revision
semantics stay in place; the token model, tool surface, UI, REST token routes and
documentation change.

P-20 (Codex write approvals and destructive confirmation) remains a separate
follow-up. Phase 10 does not add a server-side approval gate.

## Goal

Let a person create an API key for one project, give it to an MCP client, and
have that client access only that project. Keys are MCP-only. They cannot call
the REST API directly, list other projects, create projects, import, duplicate or
activate projects. Browser sessions remain the only way to manage keys.

## Locked decisions

- One key belongs to exactly one project and to the user who owns that project.
  Authentication resolves to the owner plus the bound project.
- Keys are accepted only on `/mcp`. A valid key used directly against
  `/api/v1/...` is rejected with `403 forbidden`.
- MCP tool calls still use the REST routes through in-process `inject`, but the
  dispatch carries a short-lived HMAC-signed internal context rather than the
  raw bearer token. The REST auth hook accepts that context only when the
  signature is valid and the bound project matches the route. External requests
  cannot forge it.
- Keys are created, listed and revoked on the project page through
  `GET/POST /api/v1/projects/{projectId}/tokens` and
  `DELETE /api/v1/projects/{projectId}/tokens/{tokenId}`. Only a browser session
  can call these routes.
- The current account-wide token routes (`/me/tokens`) are removed. Existing
  token rows are deleted by the migration because they were test-only.
- A key has `read` or `read`+`write` scope. Creation defaults to read-write.
- Keys expire after 3650 days by default. The maximum is 3650 days.
- The account token limit stays at 20 active keys across all projects.
- `GET /projects` for a project key returns only the bound project. A key used
  for another project id gets `404 not_found`, matching owner isolation.
- Deleting a project deletes its keys through the foreign-key cascade.
- The MCP tool list for project keys is:

  `list_projects`, `get_project`, `update_project`, `delete_project`,
  `get_document`, `replace_document`, `list_activity`, `append_activity`,
  `get_coverage`, `export_project`.

  `create_project`, `duplicate_project`, `activate_project` and
  `import_project` are not advertised because they create or affect resources
  outside the key's project.
- Every project tool keeps the explicit `projectId` argument. It must equal the
  key's project; a mismatch returns the same `404 not_found` envelope as the REST
  API. `list_projects` has no project argument.
- `delete_project` is allowed with `write` scope and remains destructive.
  `replace_document` remains destructive. Instructions still require
  confirmation, but the server does not enforce approval.
- Rename `AGENTS_template.md` to `LAYERS_AGENT_GUIDE.md`. `server/mcp/instructions.md`
  stays the MCP initialization instruction file.

## Data model and migration

Migration `003_project_api_keys.sql` rebuilds `api_tokens` with a required
`project_id` foreign key:

```sql
CREATE TABLE api_tokens (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  prefix TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  scopes TEXT NOT NULL,
  created_at TEXT NOT NULL,
  last_used_at TEXT,
  expires_at TEXT,
  revoked_at TEXT
) STRICT;
```

The old rows are intentionally discarded. Indexes cover `user_id` and
`project_id`. The store includes `projectId` in `ApiTokenRecord` and
`AuthContext`.

## Authentication and dispatch

- `requireMcpToken` accepts only `Authorization: Bearer <key>`; cookies are
  rejected on `/mcp`.
- After MCP authentication, the route signs an internal context containing the
  user id, project id, token id, scopes and a short expiry with a per-process
  random secret. The context is sent through a private header on in-process
  `inject` calls.
- The REST auth hook verifies the signature, rejects forged or expired contexts,
  loads the user, enforces token scope for the HTTP method, and rejects a route
  whose project id differs from the bound project.
- Project tokens presented directly on REST never reach the internal branch and
  return `403 forbidden`. The secret and signature are never returned to
  clients, placed in URLs, or logged.
- The REST project list filters to the bound project for internal project-key
  requests. Other project routes rely on the existing owner check plus the
  project-scope guard.

## API contract changes

| Method | Path | Credential | Purpose |
| --- | --- | --- | --- |
| `GET` | `/api/v1/projects/{projectId}/tokens` | session | List keys for the project |
| `POST` | `/api/v1/projects/{projectId}/tokens` | session | Create a key |
| `DELETE` | `/api/v1/projects/{projectId}/tokens/{tokenId}` | session | Revoke a key |

`POST` accepts `{ "name", "scopes?", "expiresInDays?" }`. Missing `scopes`
defaults to `["read", "write"]`; missing `expiresInDays` defaults to `3650`.
The secret is returned once. `ApiTokenInfo` gains `projectId`. The old
`/me/tokens` paths are removed from OpenAPI and the API.

## MCP behavior

- `list_projects` returns `{ projects: [boundProject], activeProjectId }`.
- All project tools validate `projectId === auth.projectId` before dispatch.
- The response envelope, ETag forwarding, 2 MiB limits and non-2xx
  `isError: true` behavior from phase 9 are unchanged.
- The instruction file states that the key is bound to one project, that REST
  calls are not available, and that create/import/duplicate/activate are absent.
- Deleting the bound project through MCP succeeds and revokes the key by cascade.

## UI changes

- Project actions menu gains **API keys**.
- A project-key dialog creates, lists and revokes keys, shows the secret once,
  displays scope and expiry, and explains that the key is MCP-only.
- The account page no longer manages tokens; it keeps profile and sessions and
  points to the project actions menu.
- Default form values are read-write and 3650 days.

## Documentation changes

- `docs/api.md`: project-key creation, MCP-only enforcement, default expiry and
  scope, removal of REST bearer examples, new token routes.
- `README.md`: project actions, token model, API table and remote MCP setup.
- `AGENTS_template.md` → `LAYERS_AGENT_GUIDE.md`: update references, auth model
  and MCP guidance.
- `AGENTS.md`: update the product-artifact filename and phase delivery notes.
- `server/mcp/instructions.md`: project-bound tool surface, no REST calls, no
  create/import/duplicate/activate, confirmation requirements.
- `server/api/openapi.yaml` and generated types.

## Tests and acceptance criteria

1. Token API: create, list and revoke keys per project; default scope and
   expiry; 20-key account limit; foreign project returns 404; project deletion
   removes keys; account page no longer manages tokens.
2. Authentication: project keys work on `/mcp`, fail on every direct REST route
   with `403`, and cannot use cookies on `/mcp`. Forged internal headers fail.
   Missing, malformed, expired, revoked and disabled-user keys fail.
3. MCP tools: exactly the ten listed tools are advertised. Excluded tools are
   absent. `list_projects` returns one project. A wrong `projectId` returns 404.
   Read-only keys can read but every write returns `403`. Read-write keys can
   update metadata, edit documents, append activity, read coverage and export.
4. Ownership: two users with separate keys cannot access each other's projects,
   even with known ids. A key for project A cannot read or write project B.
5. Revisions: document and metadata ETags remain separate; stale writes return
   `412 revision_conflict`; missing `If-Match` returns `428`; unrelated data is
   preserved.
6. Redaction and limits: tokens do not appear in results or logs; the 2 MiB
   request/response limits and host/origin checks still hold.
7. Quality gate: `npm run lint`, `npm run format:check`, `npm run typecheck`,
   `npm run test:unit`, `npm run test:api`, `npm run test:contract`,
   `npm run api:lint`, `npm run build`, `npm run test:e2e`, `npm run test:prod`.
8. Remote check: publish the image, deploy on the shared test host with HTTPS,
   create a project key for a disposable project, connect from the local Codex
   CLI, list/read/edit the bound project, confirm another project is invisible,
   and delete the disposable project. Record Codex and SDK versions, the tested
   digest, and cleanup. Do not print the host, domain, credentials or token.

## Boundaries

- No project sharing, multi-user project membership, OAuth, token self-service
  through MCP, additional MCP clients, search or approval enforcement.
- No account-wide keys in phase 10.
- No new container, service or database. The MCP endpoint stays in the existing
  Fastify process and Docker image.
