import { afterEach, describe, expect, it } from "vitest";
import {
  authHeaders,
  createTestApi,
  docRequest,
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

describe("user management API", () => {
  it("creates, lists, disables and enables members", async () => {
    api = await createTestApi();
    const cookie = await superCookie(api);
    const created = await api.app.inject({
      method: "POST",
      url: "/api/v1/users",
      ...docRequest(
        { email: "Ada@Example.test", password: "a-long-member-password" },
        authHeaders(cookie),
      ),
    });
    expect(created.statusCode).toBe(201);
    const user = json(created).user;
    expect(user.email).toBe("ada@example.test");
    expect(user.displayName).toBe("ada");
    expect(user.role).toBe("member");

    const list = await api.app.inject({
      method: "GET",
      url: "/api/v1/users",
      headers: authHeaders(cookie),
    });
    expect(json(list).users).toHaveLength(2);

    const disabled = await api.app.inject({
      method: "PATCH",
      url: `/api/v1/users/${user.id}`,
      ...docRequest({ disabled: true }, authHeaders(cookie)),
    });
    expect(disabled.statusCode).toBe(200);
    expect(json(disabled).user.disabledAt).toBeTruthy();

    const enabled = await api.app.inject({
      method: "PATCH",
      url: `/api/v1/users/${user.id}`,
      ...docRequest({ disabled: false }, authHeaders(cookie)),
    });
    expect(enabled.statusCode).toBe(200);
    expect(json(enabled).user.disabledAt).toBeNull();
  });

  it("rejects duplicate emails, weak passwords and invalid emails", async () => {
    api = await createTestApi();
    const cookie = await superCookie(api);
    const first = await api.app.inject({
      method: "POST",
      url: "/api/v1/users",
      ...docRequest(
        { email: "ada@example.test", password: "a-long-member-password" },
        authHeaders(cookie),
      ),
    });
    expect(first.statusCode).toBe(201);

    const duplicate = await api.app.inject({
      method: "POST",
      url: "/api/v1/users",
      ...docRequest(
        { email: "ADA@example.test", password: "a-long-member-password" },
        authHeaders(cookie),
      ),
    });
    expect(duplicate.statusCode).toBe(409);
    expect(json(duplicate).error.code).toBe("email_taken");

    const weak = await api.app.inject({
      method: "POST",
      url: "/api/v1/users",
      ...docRequest(
        { email: "weak@example.test", password: "short" },
        authHeaders(cookie),
      ),
    });
    expect(weak.statusCode).toBe(422);
    expect(json(weak).error.code).toBe("validation_failed");

    const invalid = await api.app.inject({
      method: "POST",
      url: "/api/v1/users",
      ...docRequest(
        { email: "not-an-email", password: "a-long-member-password" },
        authHeaders(cookie),
      ),
    });
    expect(invalid.statusCode).toBe(422);
  });

  it("prevents the super admin from disabling itself", async () => {
    api = await createTestApi();
    const login = await api.login(
      TEST_SUPER_ADMIN.email,
      TEST_SUPER_ADMIN.password,
    );
    const response = await api.app.inject({
      method: "PATCH",
      url: `/api/v1/users/${login.user.id}`,
      ...docRequest({ disabled: true }, authHeaders(login.cookie)),
    });
    expect(response.statusCode).toBe(403);
    expect(json(response).error.code).toBe("forbidden");
  });

  it("prevents members from managing users", async () => {
    api = await createTestApi();
    const cookie = await superCookie(api);
    const member = await api.createMember(cookie);
    const list = await api.app.inject({
      method: "GET",
      url: "/api/v1/users",
      headers: authHeaders(member.cookie),
    });
    expect(list.statusCode).toBe(403);
    expect(json(list).error.code).toBe("forbidden");

    const create = await api.app.inject({
      method: "POST",
      url: "/api/v1/users",
      ...docRequest(
        { email: "other@example.test", password: "a-long-member-password" },
        authHeaders(member.cookie),
      ),
    });
    expect(create.statusCode).toBe(403);
  });
});
