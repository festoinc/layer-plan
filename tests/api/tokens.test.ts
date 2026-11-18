import { afterEach, describe, expect, it } from "vitest";
import {
  authHeaders,
  bearerHeaders,
  createTestApi,
  docRequest,
  json,
  mcpRpc,
  TEST_SUPER_ADMIN,
  type TestApi,
} from "./helpers";

let api: TestApi | null = null;
afterEach(async () => {
  await api?.close();
  api = null;
});

async function superCookie(testApi: TestApi): Promise<string> {
  return (
    await testApi.login(TEST_SUPER_ADMIN.email, TEST_SUPER_ADMIN.password)
  ).cookie;
}

async function createProject(testApi: TestApi, cookie: string) {
  const response = await testApi.app.inject({
    method: "POST",
    url: "/api/v1/projects",
    ...docRequest({ name: "Key project" }, authHeaders(cookie)),
  });
  expect(response.statusCode).toBe(201);
  return json(response) as { id: string; metadataRevision: number };
}

describe("project API key API", () => {
  it("creates a project key, shows the secret once and lists metadata", async () => {
    api = await createTestApi();
    const cookie = await superCookie(api);
    const created = await api.app.inject({
      method: "POST",
      url: "/api/v1/projects/website/tokens",
      payload: { name: "Codex" },
      headers: authHeaders(cookie),
    });
    expect(created.statusCode).toBe(201);
    const body = json(created);
    expect(body.token).toMatch(/^lrs_/);
    expect(body.tokenInfo.projectId).toBe("website");
    expect(body.tokenInfo.scopes).toEqual(["read", "write"]);
    expect(body.tokenInfo.prefix).toBe(body.token.slice(0, 12));
    expect(body.tokenInfo.expiresAt).toBe("2035-12-30T00:00:00.000Z");

    const list = await api.app.inject({
      method: "GET",
      url: "/api/v1/projects/website/tokens",
      headers: authHeaders(cookie),
    });
    expect(list.statusCode).toBe(200);
    expect(json(list).tokens).toHaveLength(1);
    expect(json(list).tokens[0].token).toBeUndefined();
    expect(json(list).tokens[0].projectId).toBe("website");
  });

  it("rejects direct REST use of a project key", async () => {
    api = await createTestApi();
    const cookie = await superCookie(api);
    const token = await api.createToken(cookie, "website");
    for (const [method, url] of [
      ["GET", "/api/v1/projects"],
      ["GET", "/api/v1/projects/website"],
      ["GET", "/api/v1/me"],
      ["GET", "/api/v1/projects/website/tokens"],
    ] as const) {
      const response = await api.app.inject({
        method,
        url,
        headers: bearerHeaders(token),
      });
      expect(response.statusCode, `${method} ${url}`).toBe(403);
      expect(json(response).error.code).toBe("forbidden");
    }
  });

  it("enforces read-only scopes through MCP writes", async () => {
    api = await createTestApi();
    const cookie = await superCookie(api);
    const token = await api.createToken(cookie, "website", {
      scopes: ["read"],
    });
    const init = await mcpRpc(api, token, "initialize", {
      protocolVersion: "2025-03-26",
      capabilities: {},
      clientInfo: { name: "test", version: "1" },
    });
    expect(init.status).toBe(200);
    const write = await mcpRpc(api, token, "tools/call", {
      name: "update_project",
      arguments: {
        projectId: "website",
        ifMatch: '"1"',
        body: { description: "Denied" },
      },
    });
    expect(write.status).toBe(200);
    expect(write.body.result.isError).toBe(true);
    expect(JSON.parse(write.body.result.content[0].text).status).toBe(403);
  });

  it("rejects revoked and expired keys", async () => {
    api = await createTestApi();
    const cookie = await superCookie(api);
    const token = await api.createToken(cookie, "website");
    const list = await api.app.inject({
      method: "GET",
      url: "/api/v1/projects/website/tokens",
      headers: authHeaders(cookie),
    });
    const id = json(list).tokens[0].id;
    const revoke = await api.app.inject({
      method: "DELETE",
      url: `/api/v1/projects/website/tokens/${id}`,
      headers: authHeaders(cookie),
    });
    expect(revoke.statusCode).toBe(204);
    const denied = await mcpRpc(api, token, "initialize", {
      protocolVersion: "2025-03-26",
      capabilities: {},
      clientInfo: { name: "test", version: "1" },
    });
    expect(denied.status).toBe(401);

    const second = await api.createToken(cookie, "website");
    api.db
      .prepare("UPDATE api_tokens SET expires_at = ? WHERE revoked_at IS NULL")
      .run("2020-01-01T00:00:00.000Z");
    const expired = await mcpRpc(api, second, "initialize", {
      protocolVersion: "2025-03-26",
      capabilities: {},
      clientInfo: { name: "test", version: "1" },
    });
    expect(expired.status).toBe(401);
  });

  it("prevents keys from managing users, sessions or keys", async () => {
    api = await createTestApi();
    const cookie = await superCookie(api);
    const token = await api.createToken(cookie, "website");
    for (const [method, url] of [
      ["GET", "/api/v1/users"],
      ["GET", "/api/v1/auth/session"],
      ["GET", "/api/v1/auth/sessions"],
      ["GET", "/api/v1/projects/website/tokens"],
      ["POST", "/api/v1/projects/website/tokens"],
    ] as const) {
      const response = await api.app.inject({
        method,
        url,
        headers: bearerHeaders(token),
        payload: method === "POST" ? { name: "x" } : undefined,
      });
      expect(response.statusCode).toBe(403);
    }
  });

  it("scopes key management to the owning project", async () => {
    api = await createTestApi();
    const cookie = await superCookie(api);
    const alice = await api.createMember(cookie, {
      email: "keys-alice@example.test",
    });
    const bob = await api.createMember(cookie, {
      email: "keys-bob@example.test",
    });
    const project = await createProject(api, alice.cookie);
    const created = await api.app.inject({
      method: "POST",
      url: `/api/v1/projects/${project.id}/tokens`,
      payload: { name: "Alice key" },
      headers: authHeaders(alice.cookie),
    });
    expect(created.statusCode).toBe(201);

    const foreignCreate = await api.app.inject({
      method: "POST",
      url: `/api/v1/projects/${project.id}/tokens`,
      payload: { name: "Stolen" },
      headers: authHeaders(bob.cookie),
    });
    expect(foreignCreate.statusCode).toBe(404);
    const foreignList = await api.app.inject({
      method: "GET",
      url: `/api/v1/projects/${project.id}/tokens`,
      headers: authHeaders(bob.cookie),
    });
    expect(foreignList.statusCode).toBe(404);
    const foreignRevoke = await api.app.inject({
      method: "DELETE",
      url: `/api/v1/projects/${project.id}/tokens/${json(created).tokenInfo.id}`,
      headers: authHeaders(bob.cookie),
    });
    expect(foreignRevoke.statusCode).toBe(404);

    const remove = await api.app.inject({
      method: "DELETE",
      url: `/api/v1/projects/${project.id}`,
      headers: { ...authHeaders(alice.cookie), "if-match": '"1"' },
    });
    expect(remove.statusCode).toBe(200);
    const count = api.db
      .prepare("SELECT COUNT(*) AS count FROM api_tokens WHERE project_id = ?")
      .get(project.id) as { count: number };
    expect(count.count).toBe(0);
  });

  it("limits active keys to 20 per account", async () => {
    api = await createTestApi();
    const cookie = await superCookie(api);
    for (let index = 0; index < 20; index += 1) {
      const response = await api.app.inject({
        method: "POST",
        url: "/api/v1/projects/website/tokens",
        payload: { name: `Key ${index}` },
        headers: authHeaders(cookie),
      });
      expect(response.statusCode).toBe(201);
    }
    const denied = await api.app.inject({
      method: "POST",
      url: "/api/v1/projects/website/tokens",
      payload: { name: "One too many" },
      headers: authHeaders(cookie),
    });
    expect(denied.statusCode).toBe(409);
    expect(json(denied).error.code).toBe("token_limit");
  });

  it("requires a browser session to manage keys", async () => {
    api = await createTestApi();
    const missing = await api.app.inject({
      method: "GET",
      url: "/api/v1/projects/website/tokens",
    });
    expect(missing.statusCode).toBe(401);
  });
});
