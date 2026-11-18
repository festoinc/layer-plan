import { createHash, randomBytes } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import {
  authHeaders,
  bearerHeaders,
  createTestApi,
  docRequest,
  json,
  mcpCall,
  TEST_SUPER_ADMIN,
  type TestApi,
} from "./helpers";

const PUBLIC_URL = "http://127.0.0.1:3001";
const REDIRECT_URI = "https://client.example/callback";

let api: TestApi | null = null;
afterEach(async () => {
  await api?.close();
  api = null;
});

function pkce(): { verifier: string; challenge: string } {
  const verifier = randomBytes(32).toString("base64url");
  return {
    verifier,
    challenge: createHash("sha256").update(verifier).digest("base64url"),
  };
}

async function superCookie(testApi: TestApi): Promise<string> {
  return (
    await testApi.login(TEST_SUPER_ADMIN.email, TEST_SUPER_ADMIN.password)
  ).cookie;
}

async function createProject(
  testApi: TestApi,
  cookie: string,
  name = "OAuth project",
): Promise<{ id: string; name: string }> {
  const response = await testApi.app.inject({
    method: "POST",
    url: "/api/v1/projects",
    ...docRequest({ name }, authHeaders(cookie)),
  });
  expect(response.statusCode).toBe(201);
  return json(response) as { id: string; name: string };
}

async function registerClient(
  testApi: TestApi,
  input: Record<string, unknown> = {},
) {
  const response = await testApi.app.inject({
    method: "POST",
    url: "/oauth/register",
    headers: { "content-type": "application/json" },
    payload: {
      redirect_uris: [REDIRECT_URI],
      client_name: "Test MCP client",
      token_endpoint_auth_method: "none",
      ...input,
    },
  });
  return { status: response.statusCode, body: json(response) };
}

async function startAuthorization(
  testApi: TestApi,
  clientId: string,
  input: Record<string, string> = {},
) {
  const code = pkce();
  const query = new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    redirect_uri: REDIRECT_URI,
    state: "opaque-state",
    code_challenge: code.challenge,
    code_challenge_method: "S256",
    scope: "read write",
    resource: `${PUBLIC_URL}/mcp`,
    ...input,
  });
  const response = await testApi.app.inject({
    method: "GET",
    url: `/oauth/authorize?${query.toString()}`,
  });
  const location = String(response.headers.location ?? "");
  const requestId = decodeURIComponent(
    new URL(location).hash.split("/").filter(Boolean).pop() ?? "",
  );
  return { status: response.statusCode, location, requestId, ...code };
}

async function consentDetails(
  testApi: TestApi,
  cookie: string,
  requestId: string,
) {
  const response = await testApi.app.inject({
    method: "GET",
    url: `/api/v1/oauth/authorize/${encodeURIComponent(requestId)}`,
    headers: authHeaders(cookie),
  });
  return { status: response.statusCode, body: json(response) };
}

async function decide(
  testApi: TestApi,
  cookie: string,
  requestId: string,
  body: Record<string, unknown>,
) {
  const response = await testApi.app.inject({
    method: "POST",
    url: `/api/v1/oauth/authorize/${encodeURIComponent(requestId)}/decision`,
    ...docRequest(body, authHeaders(cookie)),
  });
  return { status: response.statusCode, body: json(response) };
}

async function exchange(testApi: TestApi, body: Record<string, string>) {
  const response = await testApi.app.inject({
    method: "POST",
    url: "/oauth/token",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    payload: new URLSearchParams(body).toString(),
  });
  return { status: response.statusCode, body: json(response) };
}

async function approveFlow(
  testApi: TestApi,
  cookie: string,
  projectId: string,
  options: { scopes?: string; approveScopes?: Array<"read" | "write"> } = {},
) {
  const registered = await registerClient(testApi);
  expect(registered.status).toBe(201);
  const clientId = registered.body.client_id as string;
  const authorization = await startAuthorization(testApi, clientId, {
    ...(options.scopes ? { scope: options.scopes } : {}),
  });
  expect(authorization.status).toBe(302);
  const decision = await decide(testApi, cookie, authorization.requestId, {
    decision: "approve",
    projectId,
    ...(options.approveScopes ? { scopes: options.approveScopes } : {}),
  });
  expect(decision.status).toBe(200);
  const code = new URL(decision.body.redirectTo).searchParams.get("code");
  expect(code).toBeTruthy();
  return { clientId, authorization, decision, code: code! };
}

async function completeFlow(
  testApi: TestApi,
  cookie: string,
  projectId: string,
  options: { scopes?: string; approveScopes?: Array<"read" | "write"> } = {},
) {
  const flow = await approveFlow(testApi, cookie, projectId, options);
  const token = await exchange(testApi, {
    grant_type: "authorization_code",
    client_id: flow.clientId,
    code: flow.code,
    redirect_uri: REDIRECT_URI,
    code_verifier: flow.authorization.verifier,
    resource: `${PUBLIC_URL}/mcp`,
  });
  expect(token.status).toBe(200);
  return { ...flow, token: token.body };
}

describe("MCP OAuth", () => {
  it("publishes discovery metadata and advertises OAuth to MCP clients", async () => {
    api = await createTestApi({ seed: false, publicUrl: PUBLIC_URL });
    const resource = await api.app.inject({
      method: "GET",
      url: "/.well-known/oauth-protected-resource",
    });
    expect(resource.statusCode).toBe(200);
    expect(json(resource)).toMatchObject({
      resource: `${PUBLIC_URL}/mcp`,
      authorization_servers: [PUBLIC_URL],
      scopes_supported: ["read", "write"],
      bearer_methods_supported: ["header"],
    });
    const pathResource = await api.app.inject({
      method: "GET",
      url: "/.well-known/oauth-protected-resource/mcp",
    });
    expect(json(pathResource)).toEqual(json(resource));

    const metadata = await api.app.inject({
      method: "GET",
      url: "/.well-known/oauth-authorization-server",
    });
    expect(json(metadata)).toMatchObject({
      issuer: PUBLIC_URL,
      authorization_endpoint: `${PUBLIC_URL}/oauth/authorize`,
      token_endpoint: `${PUBLIC_URL}/oauth/token`,
      registration_endpoint: `${PUBLIC_URL}/oauth/register`,
      revocation_endpoint: `${PUBLIC_URL}/oauth/revoke`,
      code_challenge_methods_supported: ["S256"],
      grant_types_supported: ["authorization_code", "refresh_token"],
    });

    const unauthenticated = await api.app.inject({
      method: "POST",
      url: "/mcp",
      headers: { "content-type": "application/json", host: "localhost" },
      payload: { jsonrpc: "2.0", id: 1, method: "initialize", params: {} },
    });
    expect(unauthenticated.statusCode).toBe(401);
    expect(String(unauthenticated.headers["www-authenticate"])).toContain(
      `resource_metadata="${PUBLIC_URL}/.well-known/oauth-protected-resource"`,
    );
  });

  it("does not expose OAuth when LAYERS_PUBLIC_URL is unset", async () => {
    api = await createTestApi({ seed: false });
    const discovery = await api.app.inject({
      method: "GET",
      url: "/.well-known/oauth-protected-resource",
    });
    expect(discovery.statusCode).toBe(404);
    const registration = await api.app.inject({
      method: "POST",
      url: "/oauth/register",
      headers: { "content-type": "application/json" },
      payload: { redirect_uris: [REDIRECT_URI] },
    });
    expect(registration.statusCode).toBe(404);
  });

  it("registers a public client, approves consent and calls MCP", async () => {
    api = await createTestApi({ seed: false, publicUrl: PUBLIC_URL });
    const cookie = await superCookie(api);
    const project = await createProject(api, cookie);
    const flow = await completeFlow(api, cookie, project.id);

    expect(flow.token.access_token).toMatch(/^loa_/);
    expect(flow.token.refresh_token).toMatch(/^lor_/);
    expect(flow.token.token_type).toBe("Bearer");
    expect(flow.token.expires_in).toBe(3600);
    expect(flow.token.scope).toBe("read write");

    const initialized = await mcpCall(
      api,
      flow.token.access_token,
      "list_projects",
    );
    expect(initialized.envelope.status).toBe(200);
    expect(
      initialized.envelope.body.projects.map((item: { id: string }) => item.id),
    ).toEqual([project.id]);

    const rest = await api.app.inject({
      method: "GET",
      url: "/api/v1/projects",
      headers: bearerHeaders(flow.token.access_token),
    });
    expect(rest.statusCode).toBe(403);

    const apiKey = await api.createToken(cookie, project.id);
    const viaKey = await mcpCall(api, apiKey, "list_projects");
    expect(viaKey.envelope.status).toBe(200);
    expect(viaKey.envelope.body.projects[0].id).toBe(project.id);
  });

  it("keeps PKCE, redirect URI and resource binding strict", async () => {
    api = await createTestApi({ seed: false, publicUrl: PUBLIC_URL });
    const cookie = await superCookie(api);
    const project = await createProject(api, cookie);
    const flow = await approveFlow(api, cookie, project.id);
    const code = flow.code;

    const wrongVerifier = await exchange(api, {
      grant_type: "authorization_code",
      client_id: flow.clientId,
      code,
      redirect_uri: REDIRECT_URI,
      code_verifier: randomBytes(32).toString("base64url"),
      resource: `${PUBLIC_URL}/mcp`,
    });
    expect(wrongVerifier.status).toBe(400);
    expect(wrongVerifier.body.error).toBe("invalid_grant");

    const wrongRedirect = await exchange(api, {
      grant_type: "authorization_code",
      client_id: flow.clientId,
      code,
      redirect_uri: "https://client.example/other",
      code_verifier: flow.authorization.verifier,
      resource: `${PUBLIC_URL}/mcp`,
    });
    expect(wrongRedirect.status).toBe(400);
    expect(wrongRedirect.body.error).toBe("invalid_grant");

    const wrongResource = await exchange(api, {
      grant_type: "authorization_code",
      client_id: flow.clientId,
      code,
      redirect_uri: REDIRECT_URI,
      code_verifier: flow.authorization.verifier,
      resource: "https://other.example/mcp",
    });
    expect(wrongResource.status).toBe(400);
    expect(wrongResource.body.error).toBe("invalid_target");

    const accepted = await exchange(api, {
      grant_type: "authorization_code",
      client_id: flow.clientId,
      code,
      redirect_uri: REDIRECT_URI,
      code_verifier: flow.authorization.verifier,
      resource: `${PUBLIC_URL}/mcp`,
    });
    expect(accepted.status).toBe(200);

    const replay = await exchange(api, {
      grant_type: "authorization_code",
      client_id: flow.clientId,
      code,
      redirect_uri: REDIRECT_URI,
      code_verifier: flow.authorization.verifier,
      resource: `${PUBLIC_URL}/mcp`,
    });
    expect(replay.status).toBe(400);
    expect(replay.body.error).toBe("invalid_grant");
  });

  it("rotates refresh tokens and revokes the grant on replay", async () => {
    api = await createTestApi({ seed: false, publicUrl: PUBLIC_URL });
    const cookie = await superCookie(api);
    const project = await createProject(api, cookie);
    const flow = await completeFlow(api, cookie, project.id);

    const refreshed = await exchange(api, {
      grant_type: "refresh_token",
      client_id: flow.clientId,
      refresh_token: flow.token.refresh_token,
      resource: `${PUBLIC_URL}/mcp`,
    });
    expect(refreshed.status).toBe(200);
    expect(refreshed.body.access_token).not.toBe(flow.token.access_token);
    expect(refreshed.body.refresh_token).not.toBe(flow.token.refresh_token);

    const afterRefresh = await mcpCall(
      api,
      refreshed.body.access_token,
      "list_projects",
    );
    expect(afterRefresh.envelope.status).toBe(200);

    const replay = await exchange(api, {
      grant_type: "refresh_token",
      client_id: flow.clientId,
      refresh_token: flow.token.refresh_token,
      resource: `${PUBLIC_URL}/mcp`,
    });
    expect(replay.status).toBe(400);
    expect(replay.body.error).toBe("invalid_grant");

    const revoked = await api.app.inject({
      method: "POST",
      url: "/mcp",
      headers: {
        ...bearerHeaders(refreshed.body.access_token),
        "content-type": "application/json",
        host: "localhost",
      },
      payload: { jsonrpc: "2.0", id: 1, method: "initialize", params: {} },
    });
    expect(revoked.statusCode).toBe(401);
  });

  it("enforces project ownership, requested scopes and read-only access", async () => {
    api = await createTestApi({ seed: false, publicUrl: PUBLIC_URL });
    const superUser = await superCookie(api);
    const alice = await api.createMember(superUser, {
      email: "oauth-alice@example.test",
    });
    const bob = await api.createMember(superUser, {
      email: "oauth-bob@example.test",
    });
    const aliceProject = await createProject(api, alice.cookie, "Alice");
    const bobProject = await createProject(api, bob.cookie, "Bob");
    const registered = await registerClient(api);
    const clientId = registered.body.client_id as string;
    const readOnly = await startAuthorization(api, clientId, {
      scope: "read",
    });
    expect(readOnly.status).toBe(302);
    const details = await consentDetails(api, alice.cookie, readOnly.requestId);
    expect(details.status).toBe(200);
    expect(details.body.request.clientName).toBe("Test MCP client");
    expect(
      details.body.projects.map((project: { id: string }) => project.id),
    ).toEqual([aliceProject.id]);

    const foreign = await decide(api, alice.cookie, readOnly.requestId, {
      decision: "approve",
      projectId: bobProject.id,
      scopes: ["read"],
    });
    expect(foreign.status).toBe(404);

    const escalation = await decide(api, alice.cookie, readOnly.requestId, {
      decision: "approve",
      projectId: aliceProject.id,
      scopes: ["read", "write"],
    });
    expect(escalation.status).toBe(422);

    const approved = await decide(api, alice.cookie, readOnly.requestId, {
      decision: "approve",
      projectId: aliceProject.id,
      scopes: ["read"],
    });
    expect(approved.status).toBe(200);
    const code = new URL(approved.body.redirectTo).searchParams.get("code")!;
    const token = await exchange(api, {
      grant_type: "authorization_code",
      client_id: clientId,
      code,
      redirect_uri: REDIRECT_URI,
      code_verifier: readOnly.verifier,
      resource: `${PUBLIC_URL}/mcp`,
    });
    expect(token.status).toBe(200);
    const listed = await mcpCall(api, token.body.access_token, "list_projects");
    expect(listed.envelope.status).toBe(200);
    expect(listed.envelope.body.projects[0].id).toBe(aliceProject.id);
    const deniedWrite = await mcpCall(
      api,
      token.body.access_token,
      "update_project",
      {
        projectId: aliceProject.id,
        ifMatch: '"1"',
        body: { description: "Denied" },
      },
    );
    expect(deniedWrite.envelope.status).toBe(403);
  });

  it("lists and revokes OAuth connections from the project session", async () => {
    api = await createTestApi({ seed: false, publicUrl: PUBLIC_URL });
    const cookie = await superCookie(api);
    const project = await createProject(api, cookie);
    const flow = await completeFlow(api, cookie, project.id);

    const list = await api.app.inject({
      method: "GET",
      url: `/api/v1/projects/${encodeURIComponent(project.id)}/oauth-grants`,
      headers: authHeaders(cookie),
    });
    expect(list.statusCode).toBe(200);
    const grants = json(list).grants as Array<{
      id: string;
      clientName: string;
      scopes: string[];
      revokedAt: string | null;
    }>;
    expect(grants).toHaveLength(1);
    expect(grants[0]?.clientName).toBe("Test MCP client");
    expect(grants[0]?.scopes).toEqual(["read", "write"]);

    const revoke = await api.app.inject({
      method: "DELETE",
      url: `/api/v1/projects/${encodeURIComponent(project.id)}/oauth-grants/${encodeURIComponent(grants[0]!.id)}`,
      headers: authHeaders(cookie),
    });
    expect(revoke.statusCode).toBe(204);

    const after = await api.app.inject({
      method: "GET",
      url: `/api/v1/projects/${encodeURIComponent(project.id)}/oauth-grants`,
      headers: authHeaders(cookie),
    });
    expect(json(after).grants[0].revokedAt).toBeTruthy();

    const mcp = await api.app.inject({
      method: "POST",
      url: "/mcp",
      headers: {
        ...bearerHeaders(flow.token.access_token),
        "content-type": "application/json",
        host: "localhost",
      },
      payload: { jsonrpc: "2.0", id: 1, method: "initialize", params: {} },
    });
    expect(mcp.statusCode).toBe(401);
  });

  it("supports confidential clients and the revocation endpoint", async () => {
    api = await createTestApi({ seed: false, publicUrl: PUBLIC_URL });
    const cookie = await superCookie(api);
    const project = await createProject(api, cookie);
    const registered = await registerClient(api, {
      token_endpoint_auth_method: "client_secret_post",
    });
    expect(registered.status).toBe(201);
    expect(registered.body.client_secret).toMatch(/^lcs_/);
    const clientId = registered.body.client_id as string;
    const clientSecret = registered.body.client_secret as string;
    const authorization = await startAuthorization(api, clientId);
    const decision = await decide(api, cookie, authorization.requestId, {
      decision: "approve",
      projectId: project.id,
      scopes: ["read", "write"],
    });
    expect(decision.status).toBe(200);
    const code = new URL(decision.body.redirectTo).searchParams.get("code")!;

    const missingSecret = await exchange(api, {
      grant_type: "authorization_code",
      client_id: clientId,
      code,
      redirect_uri: REDIRECT_URI,
      code_verifier: authorization.verifier,
      resource: `${PUBLIC_URL}/mcp`,
    });
    expect(missingSecret.status).toBe(401);
    expect(missingSecret.body.error).toBe("invalid_client");

    const token = await exchange(api, {
      grant_type: "authorization_code",
      client_id: clientId,
      client_secret: clientSecret,
      code,
      redirect_uri: REDIRECT_URI,
      code_verifier: authorization.verifier,
      resource: `${PUBLIC_URL}/mcp`,
    });
    expect(token.status).toBe(200);

    const revoke = await api.app.inject({
      method: "POST",
      url: "/oauth/revoke",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      payload: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        token: token.body.access_token,
      }).toString(),
    });
    expect(revoke.statusCode).toBe(200);

    const mcp = await api.app.inject({
      method: "POST",
      url: "/mcp",
      headers: {
        ...bearerHeaders(token.body.access_token),
        "content-type": "application/json",
        host: "localhost",
      },
      payload: { jsonrpc: "2.0", id: 1, method: "initialize", params: {} },
    });
    expect(mcp.statusCode).toBe(401);
  });

  it("rejects invalid client metadata and bad redirect URIs", async () => {
    api = await createTestApi({ seed: false, publicUrl: PUBLIC_URL });
    const httpRedirect = await registerClient(api, {
      redirect_uris: ["http://client.example/callback"],
    });
    expect(httpRedirect.status).toBe(400);
    expect(httpRedirect.body.error).toBe("invalid_redirect_uri");

    const badGrant = await registerClient(api, {
      grant_types: ["implicit"],
    });
    expect(badGrant.status).toBe(400);
    expect(badGrant.body.error).toBe("invalid_client_metadata");

    const loopback = await registerClient(api, {
      redirect_uris: ["http://127.0.0.1:54321/callback"],
    });
    expect(loopback.status).toBe(201);
  });

  it("rejects the authorization request before redirecting an unknown client", async () => {
    api = await createTestApi({ seed: false, publicUrl: PUBLIC_URL });
    const response = await api.app.inject({
      method: "GET",
      url: `/oauth/authorize?${new URLSearchParams({
        response_type: "code",
        client_id: "lcl_missing",
        redirect_uri: REDIRECT_URI,
        code_challenge: pkce().challenge,
        code_challenge_method: "S256",
      }).toString()}`,
    });
    expect(response.statusCode).toBe(400);
    expect(json(response).error).toBe("invalid_request");
    expect(response.headers.location).toBeUndefined();
  });
});
