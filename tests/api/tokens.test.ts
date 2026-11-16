import { afterEach, describe, expect, it } from "vitest";
import {
  authHeaders,
  bearerHeaders,
  createTestApi,
  json,
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

describe("API token API", () => {
  it("creates a token, shows the secret once and lists only metadata", async () => {
    api = await createTestApi();
    const cookie = await superCookie(api);
    const created = await api.app.inject({
      method: "POST",
      url: "/api/v1/me/tokens",
      payload: { name: "Local agent", scopes: ["read", "write"] },
      headers: authHeaders(cookie),
    });
    expect(created.statusCode).toBe(201);
    const body = json(created);
    expect(body.token).toMatch(/^lrs_/);
    expect(body.tokenInfo.scopes).toEqual(["read", "write"]);
    expect(body.tokenInfo.prefix).toBe(body.token.slice(0, 12));

    const list = await api.app.inject({
      method: "GET",
      url: "/api/v1/me/tokens",
      headers: authHeaders(cookie),
    });
    expect(list.statusCode).toBe(200);
    expect(json(list).tokens).toHaveLength(1);
    expect(json(list).tokens[0].token).toBeUndefined();
  });

  it("uses bearer tokens for project reads and writes", async () => {
    api = await createTestApi();
    const cookie = await superCookie(api);
    const token = await api.createToken(cookie);
    const projects = await api.app.inject({
      method: "GET",
      url: "/api/v1/projects",
      headers: bearerHeaders(token),
    });
    expect(projects.statusCode).toBe(200);

    const listed = await api.app.inject({
      method: "GET",
      url: "/api/v1/me/tokens",
      headers: authHeaders(cookie),
    });
    expect(json(listed).tokens[0].lastUsedAt).toBe("2026-01-01T00:00:00.000Z");

    const created = await api.app.inject({
      method: "POST",
      url: "/api/v1/projects",
      payload: { name: "Token project" },
      headers: { ...bearerHeaders(token), "content-type": "application/json" },
    });
    expect(created.statusCode).toBe(201);
  });

  it("enforces read-only scopes", async () => {
    api = await createTestApi();
    const cookie = await superCookie(api);
    const token = await api.createToken(cookie, { scopes: ["read"] });
    const read = await api.app.inject({
      method: "GET",
      url: "/api/v1/projects",
      headers: bearerHeaders(token),
    });
    expect(read.statusCode).toBe(200);

    const write = await api.app.inject({
      method: "POST",
      url: "/api/v1/projects",
      payload: { name: "Denied" },
      headers: { ...bearerHeaders(token), "content-type": "application/json" },
    });
    expect(write.statusCode).toBe(403);
    expect(json(write).error.code).toBe("forbidden");
    expect(json(write).error.details.requiredScope).toBe("write");
  });

  it("rejects revoked and expired tokens", async () => {
    api = await createTestApi();
    const cookie = await superCookie(api);
    const token = await api.createToken(cookie);
    const list = await api.app.inject({
      method: "GET",
      url: "/api/v1/me/tokens",
      headers: authHeaders(cookie),
    });
    const id = json(list).tokens[0].id;
    const revoke = await api.app.inject({
      method: "DELETE",
      url: `/api/v1/me/tokens/${id}`,
      headers: authHeaders(cookie),
    });
    expect(revoke.statusCode).toBe(204);
    const denied = await api.app.inject({
      method: "GET",
      url: "/api/v1/projects",
      headers: bearerHeaders(token),
    });
    expect(denied.statusCode).toBe(401);

    const second = await api.createToken(cookie);
    api.db
      .prepare("UPDATE api_tokens SET expires_at = ? WHERE revoked_at IS NULL")
      .run("2020-01-01T00:00:00.000Z");
    const expired = await api.app.inject({
      method: "GET",
      url: "/api/v1/projects",
      headers: bearerHeaders(second),
    });
    expect(expired.statusCode).toBe(401);
  });

  it("prevents tokens from managing users, sessions or tokens", async () => {
    api = await createTestApi();
    const cookie = await superCookie(api);
    const token = await api.createToken(cookie);
    for (const [method, url] of [
      ["GET", "/api/v1/users"],
      ["GET", "/api/v1/auth/session"],
      ["GET", "/api/v1/auth/sessions"],
      ["GET", "/api/v1/me/tokens"],
      ["POST", "/api/v1/me/tokens"],
    ] as const) {
      const response = await api.app.inject({
        method,
        url,
        headers: bearerHeaders(token),
        payload:
          method === "POST" ? { name: "x", scopes: ["read"] } : undefined,
      });
      expect(response.statusCode).toBe(403);
    }
  });
});
