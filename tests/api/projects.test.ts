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

describe("project catalog API", () => {
  it("seeds the sample catalog and reports the active project", async () => {
    api = await createTestApi();
    const cookie = await superCookie(api);
    const response = await api.app.inject({
      method: "GET",
      url: "/api/v1/projects",
      headers: authHeaders(cookie),
    });
    expect(response.statusCode).toBe(200);
    const body = json(response);
    expect(body.activeProjectId).toBe("website");
    expect(body.projects.map((project: { id: string }) => project.id)).toEqual([
      "website",
      "mobile",
    ]);
    expect(body.projects[0].chapterCount).toBeGreaterThan(0);
  });

  it("requires authentication for the catalog", async () => {
    api = await createTestApi();
    const response = await api.app.inject({
      method: "GET",
      url: "/api/v1/projects",
    });
    expect(response.statusCode).toBe(401);
    expect(json(response).error.code).toBe("unauthenticated");
  });

  it("creates, updates, duplicates, activates and deletes projects", async () => {
    api = await createTestApi();
    const cookie = await superCookie(api);
    const created = await api.app.inject({
      method: "POST",
      url: "/api/v1/projects",
      ...docRequest(
        {
          name: "Internal tools",
          initials: "IT",
          color: "amber",
          description: "Internal specifications.",
          testGuidelines: "Run the internal suite.",
        },
        authHeaders(cookie),
      ),
    });
    expect(created.statusCode).toBe(201);
    expect(created.headers.etag).toBe('"1"');
    const project = json(created);
    expect(project.name).toBe("Internal tools");
    expect(project.chapterCount).toBe(1);

    const activity = await api.app.inject({
      method: "GET",
      url: `/api/v1/projects/${project.id}/activity`,
      headers: authHeaders(cookie),
    });
    expect(json(activity).events[0].message).toBe("Created project");
    expect(json(activity).events[0].actorName).toBe("Super Admin");

    const updated = await api.app.inject({
      method: "PATCH",
      url: `/api/v1/projects/${project.id}`,
      headers: {
        ...authHeaders(cookie),
        "content-type": "application/json",
        "if-match": '"1"',
      },
      payload: { name: "Renamed tools", testGuidelines: "Use test data." },
    });
    expect(updated.statusCode).toBe(200);
    expect(updated.headers.etag).toBe('"2"');
    expect(json(updated).name).toBe("Renamed tools");
    expect(json(updated).testGuidelines).toBe("Use test data.");

    const stale = await api.app.inject({
      method: "PATCH",
      url: `/api/v1/projects/${project.id}`,
      headers: {
        ...authHeaders(cookie),
        "content-type": "application/json",
        "if-match": '"1"',
      },
      payload: { name: "Stale write" },
    });
    expect(stale.statusCode).toBe(412);
    expect(json(stale).error.code).toBe("revision_conflict");

    const missing = await api.app.inject({
      method: "PATCH",
      url: `/api/v1/projects/${project.id}`,
      headers: authHeaders(cookie),
      payload: { name: "No precondition" },
    });
    expect(missing.statusCode).toBe(428);

    const duplicate = await api.app.inject({
      method: "POST",
      url: `/api/v1/projects/${project.id}/duplicate`,
      headers: authHeaders(cookie),
    });
    expect(duplicate.statusCode).toBe(201);
    const copy = json(duplicate);
    expect(copy.name).toContain("copy");

    const activate = await api.app.inject({
      method: "POST",
      url: `/api/v1/projects/${project.id}/activate`,
      headers: authHeaders(cookie),
    });
    expect(activate.statusCode).toBe(200);
    expect(json(activate).activeProjectId).toBe(project.id);

    const deleted = await api.app.inject({
      method: "DELETE",
      url: `/api/v1/projects/${project.id}`,
      headers: { ...authHeaders(cookie), "if-match": '"2"' },
    });
    expect(deleted.statusCode).toBe(200);
    expect(json(deleted).activeProjectId).not.toBe(project.id);
  });

  it("rejects invalid project input", async () => {
    api = await createTestApi();
    const cookie = await superCookie(api);
    const response = await api.app.inject({
      method: "POST",
      url: "/api/v1/projects",
      ...docRequest({ name: "" }, authHeaders(cookie)),
    });
    expect(response.statusCode).toBe(422);
    expect(json(response).error.code).toBe("validation_failed");
    expect(json(response).error.details[0].path).toBe("name");
  });
});
