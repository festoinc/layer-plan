import { afterEach, describe, expect, it } from "vitest";
import {
  authHeaders,
  createTestApi,
  mcpCall,
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

async function setupUsers(testApi: TestApi) {
  const superCookie = (
    await testApi.login(TEST_SUPER_ADMIN.email, TEST_SUPER_ADMIN.password)
  ).cookie;
  const alice = await testApi.createMember(superCookie, {
    email: "alice@example.test",
    displayName: "Alice",
  });
  const bob = await testApi.createMember(superCookie, {
    email: "bob@example.test",
    displayName: "Bob",
  });
  const created = await testApi.app.inject({
    method: "POST",
    url: "/api/v1/projects",
    ...docRequest({ name: "Alice private" }, authHeaders(alice.cookie)),
  });
  expect(created.statusCode).toBe(201);
  return { superCookie, alice, bob, project: json(created) };
}

describe("project authorization", () => {
  it("isolates project catalogs and active projects per user", async () => {
    api = await createTestApi();
    const { alice, bob, project } = await setupUsers(api);

    const aliceList = await api.app.inject({
      method: "GET",
      url: "/api/v1/projects",
      headers: authHeaders(alice.cookie),
    });
    expect(
      json(aliceList).projects.map((item: { id: string }) => item.id),
    ).toEqual([project.id]);

    const bobList = await api.app.inject({
      method: "GET",
      url: "/api/v1/projects",
      headers: authHeaders(bob.cookie),
    });
    expect(json(bobList).projects).toHaveLength(0);
    expect(json(bobList).activeProjectId).toBeNull();

    const aliceActivate = await api.app.inject({
      method: "POST",
      url: `/api/v1/projects/${project.id}/activate`,
      headers: authHeaders(alice.cookie),
    });
    expect(json(aliceActivate).activeProjectId).toBe(project.id);
    const bobState = api.store.getUserState(bob.user.id);
    expect(bobState.activeProjectId).toBeNull();
  });

  it("returns 404 for another user's project on every project route", async () => {
    api = await createTestApi();
    const { alice, bob, superCookie, project } = await setupUsers(api);
    const firstDocument = await api.app.inject({
      method: "GET",
      url: `/api/v1/projects/${project.id}/document`,
      headers: authHeaders(alice.cookie),
    });

    for (const cookie of [bob.cookie, superCookie]) {
      for (const [method, url] of [
        ["GET", `/api/v1/projects/${project.id}`],
        ["PATCH", `/api/v1/projects/${project.id}`],
        ["DELETE", `/api/v1/projects/${project.id}`],
        ["POST", `/api/v1/projects/${project.id}/duplicate`],
        ["POST", `/api/v1/projects/${project.id}/activate`],
        ["GET", `/api/v1/projects/${project.id}/document`],
        ["PUT", `/api/v1/projects/${project.id}/document`],
        ["GET", `/api/v1/projects/${project.id}/activity`],
        ["POST", `/api/v1/projects/${project.id}/activity`],
        ["GET", `/api/v1/projects/${project.id}/coverage`],
        ["GET", `/api/v1/projects/${project.id}/export`],
      ] as const) {
        const payload =
          method === "PATCH"
            ? { name: "Stolen" }
            : method === "PUT"
              ? {
                  chapters: json(firstDocument).chapters,
                  selectedId: json(firstDocument).selectedId,
                }
              : method === "POST" && url.endsWith("/activity")
                ? { message: "Stolen", chapterName: "Project" }
                : undefined;
        const response = await api.app.inject({
          method,
          url,
          headers: {
            ...authHeaders(cookie),
            ...(payload ? { "content-type": "application/json" } : {}),
            ...(method === "PATCH" || method === "PUT" || method === "DELETE"
              ? { "if-match": '"1"' }
              : {}),
          },
          payload,
        });
        expect(response.statusCode, `${method} ${url}`).toBe(404);
        expect(json(response).error.code).toBe("not_found");
      }
    }
  });

  it("returns 404 before precondition checks for foreign projects", async () => {
    api = await createTestApi();
    const { bob, project } = await setupUsers(api);
    const patch = await api.app.inject({
      method: "PATCH",
      url: `/api/v1/projects/${project.id}`,
      ...docRequest({ name: "Stolen" }, authHeaders(bob.cookie)),
    });
    expect(patch.statusCode).toBe(404);

    const remove = await api.app.inject({
      method: "DELETE",
      url: `/api/v1/projects/${project.id}`,
      headers: authHeaders(bob.cookie),
    });
    expect(remove.statusCode).toBe(404);

    const save = await api.app.inject({
      method: "PUT",
      url: `/api/v1/projects/${project.id}/document`,
      ...docRequest(
        { chapters: { byId: {}, rootIds: [] }, selectedId: null },
        authHeaders(bob.cookie),
      ),
    });
    expect(save.statusCode).toBe(404);
  });

  it("keeps project ids globally unique across owners", async () => {
    api = await createTestApi();
    const { alice, bob } = await setupUsers(api);
    const first = await api.app.inject({
      method: "POST",
      url: "/api/v1/projects",
      ...docRequest(
        { id: "shared-id", name: "Alice shared" },
        authHeaders(alice.cookie),
      ),
    });
    expect(first.statusCode).toBe(201);
    const second = await api.app.inject({
      method: "POST",
      url: "/api/v1/projects",
      ...docRequest(
        { id: "shared-id", name: "Bob shared" },
        authHeaders(bob.cookie),
      ),
    });
    expect(second.statusCode).toBe(409);
    expect(json(second).error.code).toBe("project_exists");
  });

  it("assigns imported projects to the importer", async () => {
    api = await createTestApi();
    const { alice, bob, project } = await setupUsers(api);
    const exported = await api.app.inject({
      method: "GET",
      url: `/api/v1/projects/${project.id}/export`,
      headers: authHeaders(alice.cookie),
    });
    expect(exported.statusCode).toBe(200);
    const imported = await api.app.inject({
      method: "POST",
      url: "/api/v1/projects/import",
      payload: exported.payload,
      headers: {
        ...authHeaders(bob.cookie),
        "content-type": "application/json",
      },
    });
    expect(imported.statusCode).toBe(201);
    const importedId = json(imported).project.id;
    const aliceRead = await api.app.inject({
      method: "GET",
      url: `/api/v1/projects/${importedId}`,
      headers: authHeaders(alice.cookie),
    });
    expect(aliceRead.statusCode).toBe(404);
    const bobRead = await api.app.inject({
      method: "GET",
      url: `/api/v1/projects/${importedId}`,
      headers: authHeaders(bob.cookie),
    });
    expect(bobRead.statusCode).toBe(200);
  });

  it("attributes activity to the acting user", async () => {
    api = await createTestApi();
    const { alice, project } = await setupUsers(api);
    const appended = await api.app.inject({
      method: "POST",
      url: `/api/v1/projects/${project.id}/activity`,
      ...docRequest(
        { message: "Reviewed the login chapter", chapterName: "Login" },
        authHeaders(alice.cookie),
      ),
    });
    expect(appended.statusCode).toBe(201);
    expect(json(appended).events[0].actorName).toBe("Alice");
    expect(json(appended).events[0].actorUserId).toBe(alice.user.id);
  });

  it("does not let a project key cross project ownership", async () => {
    api = await createTestApi();
    const { bob, project } = await setupUsers(api);
    const created = await api.app.inject({
      method: "POST",
      url: "/api/v1/projects",
      ...docRequest({ name: "Bob private" }, authHeaders(bob.cookie)),
    });
    expect(created.statusCode).toBe(201);
    const token = await api.createToken(bob.cookie, json(created).id);
    const response = await mcpCall(api, token, "get_document", {
      projectId: project.id,
    });
    expect(response.envelope.status).toBe(404);
  });
});
