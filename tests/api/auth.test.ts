import { afterEach, describe, expect, it } from "vitest";
import {
  authHeaders,
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

describe("authentication API", () => {
  it("signs in, returns the session, and signs out idempotently", async () => {
    api = await createTestApi();
    const response = await api.app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      payload: {
        email: TEST_SUPER_ADMIN.email.toUpperCase(),
        password: TEST_SUPER_ADMIN.password,
      },
      headers: { "content-type": "application/json" },
    });
    expect(response.statusCode).toBe(200);
    const cookie = String(response.headers["set-cookie"]);
    expect(cookie).toContain("layers_session=");
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Lax");
    expect(cookie).toContain("Path=/");
    expect(cookie).not.toContain("Secure");
    const body = json(response);
    expect(body.user.email).toBe(TEST_SUPER_ADMIN.email);
    expect(body.user.role).toBe("super_admin");
    expect(body.session.id).toMatch(/^ses_/);

    const session = await api.app.inject({
      method: "GET",
      url: "/api/v1/auth/session",
      headers: authHeaders(cookie.split(";")[0]),
    });
    expect(session.statusCode).toBe(200);
    expect(json(session).user.email).toBe(TEST_SUPER_ADMIN.email);

    const logout = await api.app.inject({
      method: "POST",
      url: "/api/v1/auth/logout",
      headers: authHeaders(cookie.split(";")[0]),
    });
    expect(logout.statusCode).toBe(204);
    const again = await api.app.inject({
      method: "POST",
      url: "/api/v1/auth/logout",
      headers: authHeaders(cookie.split(";")[0]),
    });
    expect(again.statusCode).toBe(204);

    const after = await api.app.inject({
      method: "GET",
      url: "/api/v1/auth/session",
      headers: authHeaders(cookie.split(";")[0]),
    });
    expect(after.statusCode).toBe(401);
  });

  it("rejects wrong passwords, unknown emails and disabled accounts", async () => {
    api = await createTestApi();
    const wrong = await api.app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      payload: { email: TEST_SUPER_ADMIN.email, password: "wrong-password" },
      headers: { "content-type": "application/json" },
    });
    expect(wrong.statusCode).toBe(401);
    expect(json(wrong).error.code).toBe("invalid_credentials");

    const unknown = await api.app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      payload: { email: "missing@example.test", password: "wrong-password" },
      headers: { "content-type": "application/json" },
    });
    expect(unknown.statusCode).toBe(401);
    expect(json(unknown).error.code).toBe("invalid_credentials");

    const superCookieValue = await superCookie(api);
    const member = await api.createMember(superCookieValue);
    await api.app.inject({
      method: "PATCH",
      url: `/api/v1/users/${member.user.id}`,
      payload: { disabled: true },
      headers: authHeaders(superCookieValue),
    });
    const disabled = await api.app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      payload: {
        email: member.user.email,
        password: member.password,
      },
      headers: { "content-type": "application/json" },
    });
    expect(disabled.statusCode).toBe(403);
    expect(json(disabled).error.code).toBe("account_disabled");
  });

  it("rate-limits repeated sign-in attempts", async () => {
    api = await createTestApi({ loginRateLimit: 2 });
    for (let index = 0; index < 2; index += 1) {
      const response = await api.app.inject({
        method: "POST",
        url: "/api/v1/auth/login",
        payload: {
          email: TEST_SUPER_ADMIN.email,
          password: "wrong-password",
        },
        headers: { "content-type": "application/json" },
      });
      expect(response.statusCode).toBe(401);
    }
    const limited = await api.app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      payload: { email: TEST_SUPER_ADMIN.email, password: "wrong-password" },
      headers: { "content-type": "application/json" },
    });
    expect(limited.statusCode).toBe(429);
    expect(json(limited).error.code).toBe("rate_limited");
    expect(json(limited).error.details.retryAfterSeconds).toBeGreaterThan(0);
  });

  it("lists and revokes sessions", async () => {
    api = await createTestApi();
    const first = await api.login(
      TEST_SUPER_ADMIN.email,
      TEST_SUPER_ADMIN.password,
    );
    const second = await api.login(
      TEST_SUPER_ADMIN.email,
      TEST_SUPER_ADMIN.password,
    );

    const list = await api.app.inject({
      method: "GET",
      url: "/api/v1/auth/sessions",
      headers: authHeaders(first.cookie),
    });
    expect(list.statusCode).toBe(200);
    expect(json(list).sessions).toHaveLength(2);
    const current = json(list).sessions.find(
      (session: { current: boolean }) => session.current,
    );
    const other = json(list).sessions.find(
      (session: { current: boolean }) => !session.current,
    );
    expect(current).toBeTruthy();
    expect(other).toBeTruthy();

    const revokeOne = await api.app.inject({
      method: "DELETE",
      url: `/api/v1/auth/sessions/${other.id}`,
      headers: authHeaders(first.cookie),
    });
    expect(revokeOne.statusCode).toBe(204);
    const secondUse = await api.app.inject({
      method: "GET",
      url: "/api/v1/auth/sessions",
      headers: authHeaders(second.cookie),
    });
    expect(secondUse.statusCode).toBe(401);

    const secondLogin = await api.login(
      TEST_SUPER_ADMIN.email,
      TEST_SUPER_ADMIN.password,
    );
    const revokeOthers = await api.app.inject({
      method: "DELETE",
      url: "/api/v1/auth/sessions",
      headers: authHeaders(first.cookie),
    });
    expect(revokeOthers.statusCode).toBe(204);
    const after = await api.app.inject({
      method: "GET",
      url: "/api/v1/auth/sessions",
      headers: authHeaders(first.cookie),
    });
    expect(json(after).sessions).toHaveLength(1);
    const secondAfter = await api.app.inject({
      method: "GET",
      url: "/api/v1/auth/sessions",
      headers: authHeaders(secondLogin.cookie),
    });
    expect(secondAfter.statusCode).toBe(401);
  });

  it("rejects expired sessions and disabled sessions", async () => {
    api = await createTestApi();
    const login = await api.login(
      TEST_SUPER_ADMIN.email,
      TEST_SUPER_ADMIN.password,
    );
    api.db
      .prepare("UPDATE sessions SET expires_at = ?")
      .run("2020-01-01T00:00:00.000Z");
    const expired = await api.app.inject({
      method: "GET",
      url: "/api/v1/projects",
      headers: authHeaders(login.cookie),
    });
    expect(expired.statusCode).toBe(401);
    expect(json(expired).error.code).toBe("unauthenticated");
    expect(
      api.db.prepare("SELECT COUNT(*) AS count FROM sessions").get(),
    ).toEqual({ count: 0 });

    const superCookieValue = await superCookie(api);
    const member = await api.createMember(superCookieValue);
    await api.app.inject({
      method: "PATCH",
      url: `/api/v1/users/${member.user.id}`,
      payload: { disabled: true },
      headers: authHeaders(superCookieValue),
    });
    const disabled = await api.app.inject({
      method: "GET",
      url: "/api/v1/projects",
      headers: authHeaders(member.cookie),
    });
    expect(disabled.statusCode).toBe(401);
  });

  it("rejects cookie-auth mutations from a disallowed origin", async () => {
    api = await createTestApi();
    const cookie = await superCookie(api);
    const rejected = await api.app.inject({
      method: "PATCH",
      url: "/api/v1/projects/website",
      payload: { name: "Cross-site rename" },
      headers: {
        ...authHeaders(cookie),
        "content-type": "application/json",
        "if-match": '"1"',
        origin: "http://evil.example",
      },
    });
    expect(rejected.statusCode).toBe(403);
    expect(json(rejected).error.code).toBe("invalid_origin");

    const accepted = await api.app.inject({
      method: "PATCH",
      url: "/api/v1/projects/website",
      payload: { name: "Allowed rename" },
      headers: {
        ...authHeaders(cookie),
        "content-type": "application/json",
        "if-match": '"1"',
        origin: "http://127.0.0.1:5173",
      },
    });
    expect(accepted.statusCode).toBe(200);
  });

  it("rejects project API keys on REST and never exposes sessions", async () => {
    api = await createTestApi();
    const cookie = await superCookie(api);
    const token = await api.createToken(cookie, "website");
    for (const url of ["/api/v1/me", "/api/v1/auth/session"]) {
      const response = await api.app.inject({
        method: "GET",
        url,
        headers: { authorization: `Bearer ${token}` },
      });
      expect(response.statusCode, url).toBe(403);
      expect(json(response).error.code).toBe("forbidden");
    }
  });

  it("re-synchronizes the super admin from environment values", async () => {
    api = await createTestApi();
    const oldCookie = await superCookie(api);
    const before = api.authStore.getSuperAdmin();
    expect(before).toBeTruthy();

    const { bootstrap } = await import("../../server/db/bootstrap");
    const { createPasswordHasher } = await import("../../server/auth/password");
    await bootstrap({
      config: {
        ...api.config,
        superAdminPassword: "another-super-admin-password",
        superAdminName: "Renamed Super Admin",
      },
      store: api.store,
      authStore: api.authStore,
      passwordHasher: createPasswordHasher({ testMode: true }),
    });

    const after = api.authStore.getSuperAdmin();
    expect(after?.id).toBe(before?.id);
    expect(after?.displayName).toBe("Renamed Super Admin");
    expect(
      api.db.prepare("SELECT COUNT(*) AS count FROM sessions").get(),
    ).toEqual({ count: 0 });

    const oldSession = await api.app.inject({
      method: "GET",
      url: "/api/v1/projects",
      headers: authHeaders(oldCookie),
    });
    expect(oldSession.statusCode).toBe(401);
  });
});
