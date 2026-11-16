# Phase 9 — Remote MCP access

Status: planned  
Updated: 2026-11-16

## Verification in progress

- CI passed the implementation and project lifecycle tests. An isolated Docker
  image passed a loopback smoke test and was cleaned up.
- A separate isolated deployment passed public HTTPS protocol checks from the
  developer machine, including two-user project isolation and read-only token
  enforcement. Codex CLI 0.169.0 connected and listed a project over HTTPS.
- The destructive-action acceptance criterion is **not yet met**: after a
  direct request to delete the disposable project, Codex attempted the tool
  without first asking in chat. The client blocked the tool call because the
  session approval policy was `never`. An activity-write call was likewise
  blocked by that policy. The server's instructions are guidance rather than
  an enforced confirmation mechanism. A usable approval flow and a successful
  Codex write still need verification before this phase can be marked delivered.

## Goal

Connect Codex on a remote machine to a user's Layers projects over HTTPS. Users create their own Layers API token, configure it in Codex, and use MCP tools to manage projects and edit their documents. Send the adapted Layers agent instructions during MCP initialization.

## Locked decisions

- Implement a Layers-specific MCP server with the official TypeScript MCP SDK. Do not use a separate MCP proxy or gateway.
- Mount Streamable HTTP at `POST /mcp` in the existing Fastify process and Docker container. Use stateless transport: create and dispose of the SDK transport per HTTP request; do not use MCP session IDs. Implement any additional HTTP methods required by the SDK's stateless transport with its prescribed responses.
- Authenticate every MCP HTTP request using the existing bearer-token authentication. Browser cookies do not authenticate MCP. Each tool call executes with the current request's token and user; never cache identity or credentials between requests.
- Expose the exact project and document tools in section 2. User, session, token, and test administration are excluded.
- Send the adapted instructions in the MCP initialization response. Destructive actions require Codex to ask the user for confirmation; instructions and annotations are guidance, not server-enforced approval.
- HTTPS termination is required for the public endpoint. The user has a domain; determine during server testing whether existing infrastructure already provides HTTPS. Document and apply the configuration needed on that server before sending real credentials.

## 1. Architecture and request handling

Add `server/mcp/` for the MCP server, transport, tool definitions, and instructions. Register `/mcp` in the existing Fastify app. Package it in the current Docker image, on the existing application port; do not add a second container, database, service account, or database access path.

The MCP endpoint and REST API are one logical Layers resource server. Authenticate the inbound bearer token using the existing authentication code. Invoke existing REST route behavior through Fastify's in-process `inject` using the same request's `Authorization` header; do not make network requests to a public URL. The API routes remain responsible for enforcing token scope, project ownership, validation, and concurrency. Allow only the fixed routes listed below. Never accept a URL, method, authorization header, or arbitrary route from a tool argument. Never put the token in an MCP session, global state, URL, tool schema, result, or log.

The server must honor the MCP SDK's transport requirements, including protocol negotiation and JSON-RPC error handling. Pin an SDK version in the lockfile. Test the selected SDK against the actual Codex version and record both versions. No new database migrations are required.

## 2. Exact tool contracts

Tool arguments use the REST contract's existing schemas in `server/api/openapi.yaml`; reuse the server's existing validation schemas. Paths below are relative to `/api/v1`. Tool return values are `{ status, body, etag }`: `body` is the parsed JSON response; `etag` is the exact ETag header string when present, otherwise `null`. Do not expose other HTTP headers. On a non-2xx response, return `isError: true` and the same envelope, retaining the API's `error.code`, `message`, and `details`. An MCP input-schema error is returned by the SDK before dispatch.

| Tool | Arguments | API operation |
| --- | --- | --- |
| `list_projects` | none | `GET /projects` |
| `create_project` | `body: CreateProject` | `POST /projects` |
| `get_project` | `projectId: string` | `GET /projects/{projectId}` |
| `update_project` | `projectId: string`, `ifMatch: string`, `body: UpdateProject` | `PATCH /projects/{projectId}` with `If-Match` |
| `delete_project` | `projectId: string`, `ifMatch: string` | `DELETE /projects/{projectId}` with `If-Match` |
| `duplicate_project` | `projectId: string` | `POST /projects/{projectId}/duplicate` |
| `activate_project` | `projectId: string` | `POST /projects/{projectId}/activate` |
| `get_document` | `projectId: string` | `GET /projects/{projectId}/document` |
| `replace_document` | `projectId: string`, `ifMatch: string`, `body: DocumentWrite` | `PUT /projects/{projectId}/document` with `If-Match` |
| `list_activity` | `projectId: string`, optional `limit: integer` (1–100), optional `before: integer` (minimum 1) | `GET /projects/{projectId}/activity` |
| `append_activity` | `projectId: string`, `body: ActivityInput` | `POST /projects/{projectId}/activity` |
| `get_coverage` | `projectId: string` | `GET /projects/{projectId}/coverage` |
| `export_project` | `projectId: string` | `GET /projects/{projectId}/export`; return the JSON export as `body` |
| `import_project` | `body: object` containing the export JSON | `POST /projects/import` |

`ifMatch` is the exact quoted ETag returned by the corresponding `get_project` or `get_document`; forward it unchanged. A missing argument is a tool validation error. A stale ETag returns the existing `412 revision_conflict` response. Never retry or force a failed write. Metadata and document ETags are distinct. Do not retry a mutation after a timeout or unknown outcome.

Chapter creation, editing, deletion, criteria, verification, and commit references use `get_document` followed by `replace_document`; there are no separate chapter endpoints. The agent edits a copy of the complete document, sends the `DocumentWrite` shape, and preserves unrelated fields and the tree. Add only new activity entries. Keep existing limits, normalization, validation, and error semantics.

Mark the five read tools `list_projects`, `get_project`, `get_document`, `list_activity`, `get_coverage`, plus `export_project` as read-only. Mark `delete_project` and `replace_document` as destructive. Mark other tools as mutating. Annotations do not replace API authorization. `replace_document` may delete content and its instructions must ask for confirmation before removing chapters, criteria, or other existing content.

## 3. Authentication and public access

- Accept `Authorization: Bearer <Layers token>` on every `/mcp` request. Reject missing, malformed, expired, revoked, and disabled-user tokens before MCP operations execute. Do not allow browser session cookies as an alternative.
- Enforce read-only/read-write token scope and owner isolation through the existing REST routes for every call. A revoked token or disabled account must fail the next request. Return the existing unauthorized or forbidden response without revealing credentials.
- Validate the public Host and Origin on `/mcp`, including requests without an Origin as expected for Codex. Configure an explicit allowed public hostname; reject unexpected Host values and reject unexpected browser Origins. Trust forwarding headers only from the configured reverse proxy. Never trust client-provided forwarding headers directly.
- Terminate TLS at the server's existing HTTPS layer if present; otherwise configure an HTTPS reverse proxy during the server test. Bind or firewall the plain HTTP backend so it cannot be reached directly from the public internet. Preserve streaming and appropriate timeouts. Do not expose or log bearer tokens, including in proxy access logs.
- Set a 2 MiB maximum MCP request body and response body; return a clear size error and do not truncate data. Verify the limit accommodates normal document and export flows, and document the limit. Never print stack traces or secrets to clients.

## 4. Initial agent instructions

Add `server/mcp/instructions.md`, derived from `AGENTS_template.md`, and include its contents in the SDK server's initialization `instructions` field. Load the file as part of the production build and Docker image. The instructions must:

1. Explain that Layers tools are the source of truth and that the caller's token determines access; never request a password or token in chat.
2. Require reading the project and document before editing, working on one document at a time unless the user explicitly requests a batch, and never inventing IDs or existing content.
3. Describe the normalized chapter tree, `DocumentWrite`, metadata and document ETags, preservation of unrelated fields, activity entries, verification rules, and commit references.
4. Instruct Codex to ask for confirmation before project or chapter deletion, removal of existing criteria or content, and destructive conflict overwrite. On a conflict, reread and rebase; never blindly retry.
5. Explain that coverage is declaration-based, imports create new projects, and exported `instructions` describe the export format.
6. Remove local API URLs, curl commands, stack startup, database reset, and repository-specific implementation instructions.

Do not silently claim the instructions are guaranteed to be followed. Test with an actual Codex client that initialization returns the instructions and that a destructive scenario prompts for confirmation. Document the behavior observed.

## 5. Codex and Docker setup

Document signing in to Layers and creating a read-only or read-write API token. Use the Codex CLI's Streamable HTTP token configuration, verified locally via `codex mcp add --help`:

```sh
export LAYERS_API_TOKEN='<token created in Layers>'
codex mcp add layers --url https://<domain>/mcp --bearer-token-env-var LAYERS_API_TOKEN
codex mcp list
```

Explain that the variable must be available to the Codex process and that the token can be revoked from the Layers account page. Use placeholders only; never commit real tokens or the user's domain. Update the Docker and reverse-proxy instructions and document the configured HTTPS endpoint and direct-backend restrictions.

## 6. Tests and acceptance criteria

1. Protocol tests initialize `/mcp`, assert the full instructions and exact tool names, call each tool with valid and invalid arguments, and verify response envelopes and ETags. Verify the Docker image contains the instruction file.
2. Two users with separate tokens can access only their own projects, even when the other user's IDs are known. Missing, malformed, expired, revoked, and disabled-user credentials fail. Revocation and disabling take effect on the next request.
3. A read-only token succeeds on all read tools and fails every mutation. A read-write token performs every listed operation. Requests with session cookies alone fail. No administration tools or arbitrary HTTP capability are advertised.
4. Create a project and chapter, modify description, criteria, verification and commit references, append activity, inspect coverage, export/import, duplicate, activate, and delete through MCP. Results match the REST API behavior. Check unrelated document data remains intact.
5. Read a document twice; change it with the first ETag, then write with the stale second ETag. Assert `412 revision_conflict` and that the newer content remains unchanged. Repeat for metadata update and project deletion. Test missing `ifMatch` and the `etag` returned after successful writes.
6. Check host and origin rejection, body and response limits, and token redaction in logs and results. Ensure public HTTPS works and the unencrypted backend cannot be reached from the public internet.
7. On a remote machine, configure Codex with a test user's token, connect over the test domain's HTTPS endpoint, read and edit a document, and request a project deletion. Record Codex and SDK versions and demonstrate Codex asks for confirmation before deleting. Repeat access checks with a second user. Use disposable projects and test credentials.
8. Run `npm run lint`, `npm run format:check`, `npm run typecheck`, `npm run test:unit`, `npm run test:api`, `npm run test:contract`, `npm run api:lint`, `npm run build`, `npm run test:e2e`, and `npm run test:prod`, plus the new MCP tests and Docker smoke test.

## 7. Delivery sequence

1. Add the pinned SDK, stateless Fastify transport, bearer authentication, and in-process API dispatch.
2. Implement the exact tool contracts, response envelope, annotations, input validation, and instruction file.
3. Add protocol, authentication, ownership, scope, revision, and redaction tests. Update the Docker build and documentation.
4. Run the full quality gate. Configure or verify HTTPS on the test server, run the remote Codex acceptance scenario, and record results.

## 8. Boundaries and research

User management, session and token management through MCP, OAuth, project sharing, search (P-16), and additional MCP clients are out of scope. P-15 is complete only after the acceptance criteria pass. The exact HTTPS terminator depends on the test server's existing configuration; no TLS vendor is mandated.

The TypeScript SDK is selected because it allows Layers to preserve per-user authorization and document concurrency in the existing process. The [mcp-openapi bridge](https://github.com/dx-corp/mcp-openapi) documents static environment-based upstream bearer credentials and a configured inbound token; that does not establish the required per-user identity isolation. [ContextForge](https://github.com/IBM/mcp-context-forge) adds a separate gateway for a single Layers service. These are research references, not implementation options for this phase. See the [official MCP TypeScript SDK](https://github.com/modelcontextprotocol/typescript-sdk), [MCP remote authorization guidance](https://github.com/modelcontextprotocol/modelcontextprotocol/blob/main/docs/docs/2026-07-28/tutorials/security/authorization.mdx), and [OpenAI MCP server guidance](https://developers.openai.com/plugins/build/mcp-server).
