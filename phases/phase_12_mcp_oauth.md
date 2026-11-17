# Phase 12 — OAuth connections for MCP

Status: draft for review  
Updated: 2026-11-17

## Why this phase

The MCP endpoint currently accepts only a project API key. Some MCP clients and
hosted connectors do not offer a bearer-token field and can only connect through
an OAuth flow. This phase adds OAuth 2.1 authorization to the existing `/mcp`
endpoint without changing the API-key path.

An MCP request is authenticated by **either** a project API key **or** an
OAuth-issued access token. The client chooses one; there is no combined
credential and no fallback between them. Both resolve to the same owner, bound
project and scopes.

## Decisions to confirm before coding

The draft below follows the recommendation in each row. Change a row before the
phase starts if a different choice is wanted.

| # | Decision | Recommendation |
| --- | --- | --- |
| 1 | Is an OAuth connection bound to one project or to the whole account? | **One project**, selected on the consent page. Keeps the phase 10 security boundary and the existing ten-tool surface unchanged. |
| 2 | Do we implement both Dynamic Client Registration (DCR) and Client ID Metadata Documents (CIMD)? | **DCR first.** It is the fallback supported by today's OAuth-only MCP clients. Add CIMD only if the chosen acceptance client cannot use DCR. CIMD requires an SSRF-safe metadata fetcher. |
| 3 | Is consent remembered per client? | **No.** Every new authorization shows the consent page. Refresh tokens avoid repeated consent until they expire. |
| 4 | What is the default scope? | **Read + write**, with a read-only choice on the consent page. `write` implies `read`. If the client requested only `read`, the page offers read-only. |
| 5 | Token lifetimes? | Access token **1 hour**, refresh token **90 days**, authorization code **5 minutes**, pending request **10 minutes**. |

## Goal

A person can add `https://<domain>/mcp` to an OAuth-only MCP client, sign in to
Layers in the browser, choose one project and read/write access, and then use
the same MCP tools as a project API key. API-key clients keep working exactly as
they do now. Either credential can be revoked from Layers and fails on the next
request.

## Locked decisions

- Layers is both the OAuth authorization server and the MCP resource server.
  Everything runs in the existing Fastify process and SQLite database. No
  external identity provider, gateway, second container or second port.
- The OAuth grant is bound to one project and to the signed-in user who approved
  it. The MCP tool list, response envelope, ETags and 2 MiB limits do not change.
- `/mcp` accepts exactly one bearer credential:
  `Authorization: Bearer lrs_…` for an existing project API key, or
  `Authorization: Bearer loa_…` for an OAuth access token. Browser cookies still
  never authenticate MCP, and both credential types remain MCP-only.
- API keys are not migrated or reissued. Existing key creation, listing,
  revocation, scopes, expiry and instructions continue to work.
- OAuth is enabled only when `LAYERS_PUBLIC_URL` is configured. Without it, the
  OAuth endpoints return `404` and `/mcp` behaves as it does today. This keeps
  local development and existing deployments working without new configuration.
- OAuth tokens are opaque random strings stored hashed. No JWT signing keys, no
  token introspection endpoint and no token passthrough to downstream services.
- Scope names stay `read` and `write`, matching project API keys. A write grant
  includes read.
- MCP in-process dispatch keeps the HMAC-signed internal context. The raw OAuth
  token is never forwarded to the REST routes, placed in a tool result, or
  logged.

## 1. Architecture and credential selection

Add `server/oauth/` for discovery, authorization, registration, token and
revocation handlers, plus an `OAuthStore` for the new tables. Register the
routes on the existing Fastify app in `server/app.ts`. The OAuth endpoints use
the existing error handler for unexpected failures, but return standard OAuth
error bodies for protocol errors.

Authentication on `/mcp` becomes:

1. Validate Host and Origin exactly as today.
2. Read the single bearer token.
3. If it starts with `lrs_`, resolve it through the existing `api_tokens` path.
4. If it starts with `loa_`, resolve it through the new `oauth_grants` path.
5. Reject anything else with `401`, including a valid-looking token from another
   resource.

The resolved context is the same shape used today (`user`, `tokenId`,
`projectId`, `scopes`), plus `credential: "api_key" | "oauth"` for diagnostics
and tests. The internal auth context uses the API token id or OAuth grant id as
`tokenId`; the REST auth hook and project-scope guard are unchanged.

The MCP instructions file changes its wording from "this API key" to "this MCP
connection", states that either a project API key or an OAuth connection may be
used, and asks the agent never to request an OAuth code, access token, password
or another project id in chat. The ten tools and their annotations remain
identical.

## 2. Endpoints and flow

### Discovery

| Method | Path | Response |
| --- | --- | --- |
| `GET` | `/.well-known/oauth-protected-resource` | Resource metadata for the MCP server |
| `GET` | `/.well-known/oauth-protected-resource/mcp` | Same metadata at the endpoint-specific path |
| `GET` | `/.well-known/oauth-authorization-server` | Authorization-server metadata |

Protected-resource metadata:

```json
{
  "resource": "https://<public>/mcp",
  "authorization_servers": ["https://<public>"],
  "scopes_supported": ["read", "write"],
  "bearer_methods_supported": ["header"],
  "resource_name": "Layers",
  "resource_documentation": "https://<public>/api/v1/docs"
}
```

Authorization-server metadata advertises issuer, authorization, token,
registration and revocation endpoints; `response_types_supported: ["code"]`;
`grant_types_supported: ["authorization_code", "refresh_token"]`;
`code_challenge_methods_supported: ["S256"]`;
`token_endpoint_auth_methods_supported` for `none`, `client_secret_post` and
`client_secret_basic`; and `scopes_supported: ["read", "write"]`. It does not
advertise CIMD. OIDC discovery is not served because Layers issues no ID token.

When OAuth is enabled, a `401` from `/mcp` includes:

```http
WWW-Authenticate: Bearer resource_metadata="https://<public>/.well-known/oauth-protected-resource", scope="read write"
```

The header is added for missing, malformed, expired, revoked and
wrong-audience tokens. A tool call with a valid read-only token that attempts a
write still returns the existing MCP `403` envelope inside the JSON-RPC result;
HTTP-level step-up authorization is not implemented in this phase.

### Authorization request

`GET /oauth/authorize` accepts `response_type=code`, `client_id`,
`redirect_uri`, `state` (optional), `code_challenge`,
`code_challenge_method=S256`, `scope` (optional) and `resource` (optional).

- Validate the client and redirect URI before redirecting anywhere. An unknown
  client or mismatched redirect URI gets `400` and no redirect.
- Require `response_type=code` and PKCE S256. `plain` is rejected.
- Accept a resource equal to the canonical MCP resource, the public origin, or
  the same value with one trailing slash. Normalize it to `https://<public>/mcp`.
  If omitted, default to that canonical value for client compatibility.
- Validate scopes against `read` and `write`; unknown scopes return
  `invalid_scope` through the validated redirect URI. If omitted, request both.
- Create a pending authorization request and redirect the browser to
  `/#/oauth/consent/<requestId>`. The request id is opaque, random and valid for
  10 minutes.

The browser hash route is used because the UI is a hash-router SPA. The
authorization endpoint is still the standard OAuth URL that clients open.

### Consent and decision

| Method | Path | Credential | Purpose |
| --- | --- | --- | --- |
| `GET` | `/api/v1/oauth/authorize/{requestId}` | session | Read client, redirect host, requested scopes and expiry |
| `POST` | `/api/v1/oauth/authorize/{requestId}/decision` | session | Approve or deny |

The decision body is
`{ "decision": "approve" | "deny", "projectId": "<owned project>", "scopes": ["read"] | ["read", "write"] }`.
The server validates that the request is pending and unexpired, the project
belongs to the session user, and the granted scopes are a subset of the
requested scopes. On approve it issues a single-use authorization code bound to
the client, redirect URI, PKCE challenge, resource, user, project and scopes.
On deny it records the denial. Both responses return `{ redirectTo }`; the UI
navigates there. The redirect carries `code` and the original `state`, or
`error=access_denied` and `state`.

### Token endpoint

`POST /oauth/token` accepts `application/x-www-form-urlencoded` only.

- `grant_type=authorization_code`: validate the code hash, client, exact
  redirect URI, PKCE verifier, resource and expiry; consume the code atomically;
  issue an access token and refresh token.
- `grant_type=refresh_token`: validate the grant, client and resource; rotate
  both tokens; keep the refresh expiry absolute. Reuse of the immediately
  previous refresh token revokes the grant.
- Client authentication: `none` for public clients (PKCE is mandatory),
  `client_secret_post`, or `client_secret_basic`. Reject multiple methods,
  wrong secrets and clients that do not own the code or grant.
- Success returns
  `{ access_token, token_type: "Bearer", expires_in: 3600, refresh_token, scope: "read write" }`
  with `Cache-Control: no-store`.

Protocol failures use standard bodies such as
`{ "error": "invalid_grant", "error_description": "…" }` with `400` or `401`.
They never include internal ids, hashes or stack traces.

### Dynamic client registration

`POST /oauth/register` accepts RFC 7591 client metadata as JSON:

- `redirect_uris`: 1–10 absolute URIs, no fragment and no userinfo. `https` is
  allowed; `http` only for loopback hosts; private-use schemes are allowed for
  native clients. Redirect URIs are exact matches, except that loopback ports
  may vary per RFC 8252.
- `grant_types` and `response_types`: only `authorization_code` and `code`.
- `token_endpoint_auth_method`: `none`, `client_secret_post` or
  `client_secret_basic`. If omitted, follow RFC 7591 and issue a secret using
  `client_secret_basic`.
- `client_name` is trimmed, length-limited and displayed on the consent page.
  Missing names fall back to a neutral label.
- Generate `lcl_…` client ids and, when needed, `lcs_…` secrets. Store only the
  secret hash. Return the secret once.

Registration is open by design. Apply a per-IP rate limit, cap stored clients,
cap request size and prune clients that never obtained a grant after 30 days.
The consent page displays both the client name and the redirect host so an
attacker-controlled client name cannot hide where the code will be sent.

### Revocation

`POST /oauth/revoke` follows RFC 7009. A client may revoke its access or refresh
token; the whole grant is revoked and the endpoint returns `200` even for an
unknown or already-revoked token. The project **MCP access** dialog can revoke
the same grant through a session-authenticated route.

### End-to-end flow

```text
Client                         Layers                         Browser
  |                               |                               |
  |-- POST /mcp (no token) ------>|                               |
  |<-- 401 + resource metadata ---|                               |
  |-- GET protected resource ---->|                               |
  |-- GET AS metadata ----------->|                               |
  |-- POST /oauth/register ------>|                               |
  |<-- client_id -----------------|                               |
  |                               |<-- GET /oauth/authorize ------|
  |                               |--- 302 to consent page ------>|
  |                               |<-- sign in (if needed) -------|
  |                               |<-- GET consent details -------|
  |                               |<-- POST decision (approve) ---|
  |                               |--- redirect with code ------->|
  |-- POST /oauth/token --------->|                               |
  |<-- access + refresh ----------|                               |
  |-- POST /mcp (Bearer access) ->|                               |
```

## 3. Data model and migration

Add `server/db/migrations/004_oauth.sql`. Existing tables and rows are not
changed. All tokens, codes and secrets are stored as SHA-256 hashes; the
plaintext is returned only in the response that creates it.

| Table | Purpose and key fields |
| --- | --- |
| `oauth_clients` | Registered clients: id, name, redirect URIs (JSON), grant and response types, auth method, secret hash, source, created/last-used timestamps |
| `oauth_authorization_requests` | Pending consent: id, client, redirect URI, scopes, state, PKCE challenge, resource, expiry, status, decided user/project |
| `oauth_authorization_codes` | Single-use codes: code hash, client, user, project, scopes, redirect URI, PKCE challenge, resource, expiry, consumed timestamp |
| `oauth_grants` | One connection: client, user, project, scopes, resource, access hash, refresh hash, previous refresh hash, access/refresh expiry, created/last-used/revoked timestamps |

Constraints and indexes:

- Foreign keys cascade when a user or project is deleted; a deleted project
  invalidates its OAuth connections.
- Unique hashes for access tokens, refresh tokens and authorization codes.
- Index grants by `(user_id, project_id)`, by access hash and by refresh hash;
  index requests and codes by expiry for cleanup.
- A cleanup routine removes expired pending requests and codes, and old
  consumed codes. Grants are kept until revoked or expired for audit/UI.
- No destructive migration of `api_tokens` or `project_documents`.

## 4. Consent UI

Add a `#/oauth/consent/<requestId>` route. `AuthGate` must render the consent
page before the workspace views, and must keep working when the user is
unauthenticated: the existing sign-in page appears, and after login the same
route continues to the consent page.

The page shows:

- the requesting client name and the redirect URI hostname;
- the project selector, limited to projects owned by the signed-in user;
- read-only versus read-write access, limited to the scopes the client
  requested;
- the exact permission summary and the fact that the connection can be revoked
  in Layers;
- **Approve** and **Deny** buttons.

There is no auto-approve, no "remember this app" checkbox, no iframe embedding
and no logo fetched from a remote URL. Pending, approved, denied and expired
requests have distinct states. Approving or denying navigates to the returned
`redirectTo`; if that navigation fails, the page shows the callback URL and a
clear error. The page uses the existing auth, focus and accessibility patterns.

## 5. MCP behavior

- The tool list remains:
  `list_projects`, `get_project`, `update_project`, `delete_project`,
  `get_document`, `replace_document`, `list_activity`, `append_activity`,
  `get_coverage`, `export_project`.
- `list_projects` returns the bound project for both credential types.
- A `projectId` that differs from the grant's project returns the existing
  `404 not_found` envelope before dispatch.
- `read` allows read tools; `write` allows reads and writes. The write tools
  keep their destructive annotations and confirmation instructions.
- On each request, check that the grant is not revoked, the access token is
  unexpired, the user is enabled and the token audience equals the canonical
  MCP resource.
- Revocation, project deletion and user disabling take effect on the next
  request. Refresh does not bypass any of these checks.
- Tokens are redacted from logs and never appear in MCP results. The existing
  Authorization and cookie redaction stays in place.
- No OAuth token can call `/api/v1/...` directly; the middleware returns
  `403 forbidden`, matching the API-key rule.

## 6. Management UI

Rename the project **API keys** dialog to **MCP access** and keep the existing
API-key section. Add a **Connected apps** section listing OAuth connections for
the current project: client name, scopes, created, last used and status. Each
row can be revoked with confirmation. Revoking invalidates the access and
refresh tokens immediately.

The account page keeps profile and browser sessions. A cross-project
"authorized apps" view is deferred; the project dialog is the single place to
manage a connection in this phase.

New session-authenticated REST routes:

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/v1/projects/{projectId}/oauth-grants` | List OAuth connections for the project |
| `DELETE` | `/api/v1/projects/{projectId}/oauth-grants/{grantId}` | Revoke one connection |

Both require an owner session, return `404` for another user's project and use
the existing serializers/error format.

## 7. Configuration and deployment

Add `LAYERS_PUBLIC_URL` to `server/config.ts`, `.env.example`, the README
environment table and the Docker deployment notes.

- It must be an absolute URL with no query or fragment. `https` is required
  except for loopback development, where `http://127.0.0.1:<port>` and
  `http://localhost:<port>` are allowed.
- The configured value is used to build the issuer, resource, discovery URLs and
  redirects. Never derive these from the request Host header.
- Unset means OAuth is disabled; API keys still work.
- Changing the value requires a restart. Existing OAuth grants remain valid only
  for the same canonical resource; tokens issued for the old resource stop
  working, and users re-authorize.
- Docker and Compose need no new port or service. The image already copies the
  migrations directory and the MCP instruction file. The existing reverse proxy
  already forwards all paths to the app; ensure `/oauth/*` and `/.well-known/*`
  are not cached or blocked, and keep Authorization and request bodies out of
  proxy logs.
- Document `LAYERS_SECURE_COOKIES=1` for public HTTPS deployments so the session
  used during consent is marked `Secure`.

## 8. Security controls

- HTTPS everywhere except loopback development; no OAuth credentials over plain
  public HTTP.
- PKCE S256 mandatory for every authorization-code exchange.
- Exact redirect URI matching, loopback-port flexibility only, no fragments,
  no userinfo, no open redirects.
- `state` passed through unchanged, never interpreted as authority.
- Authorization codes are random, hashed, single-use, short-lived and bound to
  client, redirect URI, verifier, resource, user, project and scopes.
- Access and refresh tokens are opaque and hashed at rest. Refresh rotation with
  immediate-reuse revocation.
- Audience/resource binding on authorize, token and `/mcp`. Tokens issued for
  another resource are rejected.
- Consent requires a browser session and a valid Origin; the decision endpoint
  is a POST and the request id is unguessable. The page is not frameable.
- DCR is rate-limited, size-limited, pruned and capped. The consent page always
  shows the redirect host.
- CIMD is not fetched in this phase, so there is no server-side URL fetch and no
  SSRF surface. If CIMD is added later, it needs an SSRF-safe fetcher with DNS
  and private-address checks.
- No secrets in URLs, logs, MCP results or error messages. Token and
  registration responses use `Cache-Control: no-store`.
- Scope escalation is impossible through the decision route: granted scopes must
  be a subset of requested scopes, and the project must be owned by the approver.

## 9. Documentation changes

- `README.md`: OAuth connection steps, the either/or credential model, the
  `LAYERS_PUBLIC_URL` environment variable and updated MCP examples.
- `docs/api.md`: discovery endpoints, DCR, authorization, consent, token,
  refresh, revocation, scopes, lifetimes, error behavior and limitations.
- `LAYERS_AGENT_GUIDE.md`: MCP credentials may be API keys or OAuth
  connections; all existing document rules stay unchanged.
- `server/mcp/instructions.md`: connection wording and OAuth-specific "never ask
  for codes or tokens in chat" guidance.
- `server/api/openapi.yaml` and generated types for the new session-authenticated
  consent/grant routes. Standard OAuth and discovery endpoints are documented in
  prose, not added to the `/api/v1` contract unless the spec structure supports
  them cleanly.
- `AGENTS.md` and `phase-ideas.md` only if the delivery changes repository
  guidance or leaves a new deferred idea.

## 10. Tests and acceptance criteria

1. **Unit:** PKCE S256 verification, redirect URI matching including loopback
   ports and private-use schemes, client authentication methods, scope
   normalization, resource canonicalization, refresh rotation and reuse
   detection, token/code hashing and expiry.
2. **Discovery:** protected-resource metadata at both paths, authorization-server
   metadata, exact endpoint URLs, scopes and PKCE methods. `401` from `/mcp`
   carries the `WWW-Authenticate` resource metadata and scope.
3. **Registration:** valid public and confidential clients; missing/oversized
   metadata; bad redirect URIs; unsupported grant, response or auth method;
   secret returned once and stored hashed; rate limit and client cap.
4. **Authorization and consent:** sign-in continuation on the hash route;
   approve and deny; project ownership; scope downgrade; requested-scope
   escalation rejected; expired/reused/forged request ids; foreign project
   returns `404`; missing session or bad Origin rejected.
5. **Tokens:** code exchange with and without PKCE, wrong verifier, wrong client,
   wrong redirect URI, wrong resource, expired and reused code; refresh success,
   rotation, reuse revocation, revoked grant and expired refresh; revocation
   endpoint idempotence.
6. **MCP with OAuth:** initialize and all ten tools; read-only read success and
   write `403`; read-write edit and stale `412`; `list_projects` returns one
   project; another project id returns `404`; audience mismatch, expired access,
   revoked grant, disabled user and deleted project fail on the next request.
7. **Either/or regression:** an existing project API key still initializes and
   calls every tool; OAuth and API-key requests can be used by two different
   clients against the same `/mcp`; cookies alone still fail; OAuth tokens on
   REST return `403`; API keys on REST still return `403`.
8. **UI:** consent page approve/deny/expired states, sign-in continuation,
   read-only/read-write choice, project selector, connected-apps list and revoke;
   keyboard and screen-reader checks follow the existing Playwright patterns.
9. **Secrets:** tokens, codes, client secrets and authorization headers never
   appear in logs, MCP results, HTML or URLs other than the standard code
   redirect.
10. **Quality gate:** `npm run lint`, `npm run format:check`, `npm run typecheck`,
    `npm run test:unit`, `npm run test:api`, `npm run test:contract`,
    `npm run api:lint`, `npm run build`, `npm run test:e2e`, `npm run test:prod`.
11. **Remote acceptance:** publish the image, deploy on the shared test host with
    the existing HTTPS proxy and `LAYERS_PUBLIC_URL`, and connect with a real
    OAuth-only MCP client. Also connect the existing API-key client to prove
    both paths work. Record the client names/versions and the tested digest.
    Verify revocation, project isolation, an expired access token with refresh,
    and cleanup. Never print the host, domain, credentials or tokens.

## 11. Delivery sequence

1. Add config, migration, store and hashed credential helpers.
2. Add discovery, DCR, authorize, token, refresh and revoke endpoints.
3. Add OAuth resolution to `/mcp`, the 401 challenge header and instruction
   wording; keep the API-key path untouched.
4. Add the consent route/page and the connected-apps management UI.
5. Update OpenAPI, README, `docs/api.md`, `LAYERS_AGENT_GUIDE.md`,
   `server/mcp/instructions.md` and `.env.example`.
6. Run the quality gate in CI, publish, run the remote OAuth and API-key
   acceptance scenarios, and record the tested digest and cleanup.

## 12. Boundaries

- No account-wide OAuth connection in this phase; the grant remains project
  bound. Account-wide access would need a different tool surface and consent
  model.
- No CIMD unless the chosen acceptance client requires it; then it is added
  with an SSRF-safe fetcher and specific tests before delivery.
- No external identity provider, OIDC discovery, ID tokens, DPoP, mTLS,
  introspection endpoint, JWT access tokens or token exchange.
- No OAuth for the REST API. OAuth credentials remain MCP-only, like project
  API keys.
- No persistent consent, cross-project authorized-apps page or per-tool step-up
  authorization. A read-only tool failure surfaces as the existing MCP `403`
  envelope.
- P-20 (destructive-action confirmation) remains a separate follow-up. OAuth
  does not add a server-side approval gate.
- No project sharing, user deletion/transfer, search or additional MCP clients
  beyond the acceptance tests.
