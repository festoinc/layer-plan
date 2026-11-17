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

async function getDocument(testApi: TestApi, cookie: string, id = "website") {
  const response = await testApi.app.inject({
    method: "GET",
    url: `/api/v1/projects/${id}/document`,
    headers: authHeaders(cookie),
  });
  expect(response.statusCode).toBe(200);
  return { body: json(response), etag: response.headers.etag as string };
}

describe("document API", () => {
  it("reads and replaces a document with optimistic concurrency", async () => {
    api = await createTestApi();
    const cookie = await superCookie(api);
    const first = await getDocument(api, cookie);
    expect(first.etag).toBe('"1"');
    expect(first.body.chapters.byId["password-reset"]).toBeDefined();

    const chapters = {
      ...first.body.chapters,
      byId: {
        ...first.body.chapters.byId,
        "password-reset": {
          ...first.body.chapters.byId["password-reset"],
          title: "Reset password",
        },
      },
    };
    const saved = await api.app.inject({
      method: "PUT",
      url: "/api/v1/projects/website/document",
      headers: {
        ...authHeaders(cookie),
        "content-type": "application/json",
        "if-match": first.etag,
      },
      payload: {
        chapters,
        selectedId: first.body.selectedId,
        activity: [
          {
            id: "event-1",
            message: "Renamed password reset",
            chapterId: "password-reset",
            chapterName: "Reset password",
          },
        ],
      },
    });
    expect(saved.statusCode).toBe(200);
    expect(saved.headers.etag).toBe('"2"');
    const body = json(saved);
    expect(body.revision).toBe(2);
    expect(body.chapters.byId["password-reset"].title).toBe("Reset password");
    expect(body.activity[0].message).toBe("Renamed password reset");
    expect(body.activity[0].time).toBe("2026-01-01T00:00:00.000Z");
    expect(body.activity[0].actorName).toBe("Super Admin");

    const stale = await api.app.inject({
      method: "PUT",
      url: "/api/v1/projects/website/document",
      headers: {
        ...authHeaders(cookie),
        "content-type": "application/json",
        "if-match": first.etag,
      },
      payload: { chapters, selectedId: first.body.selectedId },
    });
    expect(stale.statusCode).toBe(412);
    expect(json(stale).error.details.currentRevision).toBe(2);
  });

  it("creates subchapters for new criteria and is idempotent", async () => {
    api = await createTestApi();
    const cookie = await superCookie(api);
    const first = await getDocument(api, cookie);
    const chapters = structuredClone(first.body.chapters);
    const parent = chapters.byId["password-reset"];
    expect(parent.finalLevel).toBe(false);
    parent.criteria.push({
      id: "new-criterion",
      text: "**Ship** it today",
      checked: false,
    });

    const saved = await api.app.inject({
      method: "PUT",
      url: "/api/v1/projects/website/document",
      headers: {
        ...authHeaders(cookie),
        "content-type": "application/json",
        "if-match": first.etag,
      },
      payload: { chapters, selectedId: first.body.selectedId },
    });
    expect(saved.statusCode).toBe(200);
    const body = json(saved);
    expect(body.createdSubchapters).toHaveLength(1);
    const created = body.createdSubchapters[0];
    expect(created).toMatchObject({
      parentId: "password-reset",
      criterionId: "new-criterion",
      title: "Ship it today",
    });
    expect(body.chapters.byId["password-reset"].childIds).toContain(created.id);
    expect(
      body.chapters.byId["password-reset"].criteria.find(
        (item: { id: string }) => item.id === "new-criterion",
      ).chapterId,
    ).toBe(created.id);
    expect(body.chapters.byId[created.id]).toMatchObject({
      parentId: "password-reset",
      title: "Ship it today",
      description: "**Ship** it today",
    });
    expect(
      body.activity.some(
        (event: { message: string }) =>
          event.message === "Created subchapter from success criterion",
      ),
    ).toBe(true);

    const again = await api.app.inject({
      method: "PUT",
      url: "/api/v1/projects/website/document",
      headers: {
        ...authHeaders(cookie),
        "content-type": "application/json",
        "if-match": saved.headers.etag as string,
      },
      payload: {
        chapters: body.chapters,
        selectedId: body.selectedId,
      },
    });
    expect(again.statusCode).toBe(200);
    expect(json(again).createdSubchapters).toEqual([]);
    expect(json(again).revision).toBe(body.revision);
  });

  it("skips final-level chapters, empty text and already-linked criteria", async () => {
    api = await createTestApi();
    const cookie = await superCookie(api);
    const first = await getDocument(api, cookie);
    const chapters = structuredClone(first.body.chapters);
    const parent = chapters.byId["password-reset"];
    const childCount = parent.childIds.length;
    parent.finalLevel = true;
    parent.criteria.push(
      { id: "final-criterion", text: "Final outcome", checked: false },
      { id: "empty-criterion", text: "   ", checked: false },
    );
    chapters.byId["manual-sub"] = {
      ...structuredClone(parent),
      id: "manual-sub",
      parentId: "password-reset",
      title: "Manual supporting notes",
      criteria: [],
      childIds: [],
      finalLevel: false,
    };
    parent.childIds.push("manual-sub");
    parent.criteria.push({
      id: "linked-criterion",
      text: "Already linked",
      checked: false,
      chapterId: "manual-sub",
    });

    const saved = await api.app.inject({
      method: "PUT",
      url: "/api/v1/projects/website/document",
      headers: {
        ...authHeaders(cookie),
        "content-type": "application/json",
        "if-match": first.etag,
      },
      payload: { chapters, selectedId: first.body.selectedId },
    });
    expect(saved.statusCode).toBe(200);
    const body = json(saved);
    expect(body.createdSubchapters).toEqual([]);
    expect(body.chapters.byId["password-reset"].childIds).toHaveLength(
      childCount + 1,
    );
    expect(
      body.chapters.byId["password-reset"].criteria.find(
        (item: { id: string }) => item.id === "final-criterion",
      ).chapterId,
    ).toBeUndefined();
    expect(
      body.chapters.byId["password-reset"].criteria.find(
        (item: { id: string }) => item.id === "empty-criterion",
      ).chapterId,
    ).toBeUndefined();
  });

  it("does not backfill existing standalone criteria", async () => {
    api = await createTestApi();
    const cookie = await superCookie(api);
    const first = await getDocument(api, cookie);
    const chapters = structuredClone(first.body.chapters);
    const parent = chapters.byId["password-reset"];
    parent.finalLevel = true;
    parent.criteria.push({
      id: "standalone",
      text: "Keep me standalone",
      checked: false,
    });
    const firstSave = await api.app.inject({
      method: "PUT",
      url: "/api/v1/projects/website/document",
      headers: {
        ...authHeaders(cookie),
        "content-type": "application/json",
        "if-match": first.etag,
      },
      payload: { chapters, selectedId: first.body.selectedId },
    });
    expect(firstSave.statusCode).toBe(200);
    expect(json(firstSave).createdSubchapters).toEqual([]);

    const current = await getDocument(api, cookie);
    const reopened = structuredClone(current.body.chapters);
    reopened.byId["password-reset"].finalLevel = false;
    const secondSave = await api.app.inject({
      method: "PUT",
      url: "/api/v1/projects/website/document",
      headers: {
        ...authHeaders(cookie),
        "content-type": "application/json",
        "if-match": current.etag,
      },
      payload: {
        chapters: reopened,
        selectedId: current.body.selectedId,
      },
    });
    expect(secondSave.statusCode).toBe(200);
    expect(json(secondSave).createdSubchapters).toEqual([]);
    expect(
      json(secondSave).chapters.byId["password-reset"].criteria.find(
        (item: { id: string }) => item.id === "standalone",
      ).chapterId,
    ).toBeUndefined();
  });

  it("does not bump the revision for an identical document", async () => {
    api = await createTestApi();
    const cookie = await superCookie(api);
    const first = await getDocument(api, cookie);
    const saved = await api.app.inject({
      method: "PUT",
      url: "/api/v1/projects/website/document",
      headers: {
        ...authHeaders(cookie),
        "content-type": "application/json",
        "if-match": first.etag,
      },
      payload: {
        chapters: first.body.chapters,
        selectedId: first.body.selectedId,
      },
    });
    expect(saved.statusCode).toBe(200);
    expect(json(saved).revision).toBe(1);
  });

  it("validates selected chapters and document shape", async () => {
    api = await createTestApi();
    const cookie = await superCookie(api);
    const first = await getDocument(api, cookie);
    const invalidSelected = await api.app.inject({
      method: "PUT",
      url: "/api/v1/projects/website/document",
      headers: {
        ...authHeaders(cookie),
        "content-type": "application/json",
        "if-match": first.etag,
      },
      payload: {
        chapters: first.body.chapters,
        selectedId: "missing-chapter",
      },
    });
    expect(invalidSelected.statusCode).toBe(422);
    expect(json(invalidSelected).error.code).toBe("validation_failed");

    const invalidBody = await api.app.inject({
      method: "PUT",
      url: "/api/v1/projects/website/document",
      headers: {
        ...authHeaders(cookie),
        "content-type": "application/json",
        "if-match": first.etag,
      },
      payload: { chapters: {}, selectedId: null },
    });
    expect(invalidBody.statusCode).toBe(422);
  });

  it("deduplicates and caps activity", async () => {
    api = await createTestApi();
    const cookie = await superCookie(api);
    let document = await getDocument(api, cookie);
    for (let index = 0; index < 105; index += 1) {
      const saved = await api.app.inject({
        method: "PUT",
        url: "/api/v1/projects/website/document",
        headers: {
          ...authHeaders(cookie),
          "content-type": "application/json",
          "if-match": document.etag,
        },
        payload: {
          chapters: document.body.chapters,
          selectedId: document.body.selectedId,
          activity: [
            {
              id: `event-${index}`,
              message: `Event ${index}`,
              chapterId: null,
              chapterName: "Website project",
            },
            {
              id: `event-${index}`,
              message: `Duplicate ${index}`,
              chapterId: null,
              chapterName: "Website project",
            },
          ],
        },
      });
      expect(saved.statusCode).toBe(200);
      document = { body: json(saved), etag: saved.headers.etag as string };
    }
    const activity = await api.app.inject({
      method: "GET",
      url: "/api/v1/projects/website/activity?limit=200",
      headers: authHeaders(cookie),
    });
    const events = json(activity).events;
    expect(events).toHaveLength(100);
    expect(events[0].message).toBe("Event 104");
  });

  it("reports corrupt stored documents instead of silently resetting them", async () => {
    api = await createTestApi();
    const cookie = await superCookie(api);
    api.db
      .prepare(
        "UPDATE project_documents SET chapters_json = ? WHERE project_id = ?",
      )
      .run("{bad json", "website");
    const response = await api.app.inject({
      method: "GET",
      url: "/api/v1/projects/website/document",
      headers: authHeaders(cookie),
    });
    expect(response.statusCode).toBe(500);
    expect(json(response).error.code).toBe("stored_data_invalid");
  });

  it("returns coverage from the stored document", async () => {
    api = await createTestApi();
    const cookie = await superCookie(api);
    const response = await api.app.inject({
      method: "GET",
      url: "/api/v1/projects/website/coverage",
      headers: authHeaders(cookie),
    });
    expect(response.statusCode).toBe(200);
    const body = json(response);
    expect(body.summary.total).toBeGreaterThan(0);
    expect(body.rows[0].chapterPath).toBeDefined();
    expect(body.testGuidelines).toContain("npm test");
  });

  it("exports and imports a project", async () => {
    api = await createTestApi();
    const cookie = await superCookie(api);
    const exported = await api.app.inject({
      method: "GET",
      url: "/api/v1/projects/website/export",
      headers: authHeaders(cookie),
    });
    expect(exported.statusCode).toBe(200);
    const payload = json(exported);
    expect(payload.format).toBe("layers-project");
    expect(payload.formatVersion).toBe(4);
    expect(payload.instructions).toContain("# Layers project export");
    expect(payload.instructions).toContain("POST /api/v1/projects/import");
    expect(
      payload.activity.every(
        (event: { actorName?: string }) => event.actorName === undefined,
      ),
    ).toBe(true);

    payload.chapters.byId["password-reset"].title = "Imported reset";
    const imported = await api.app.inject({
      method: "POST",
      url: "/api/v1/projects/import",
      ...docRequest(payload, authHeaders(cookie)),
    });
    expect(imported.statusCode).toBe(201);
    const body = json(imported);
    expect(body.project.name).toContain("(imported)");
    const document = await getDocument(api, cookie, body.project.id);
    expect(document.body.chapters.byId["password-reset"].title).toBe(
      "Imported reset",
    );
  });

  it("resets the test database through the guarded endpoint", async () => {
    api = await createTestApi();
    const reset = await api.app.inject({
      method: "POST",
      url: "/api/v1/test/reset",
    });
    expect(reset.statusCode).toBe(204);
    const cookie = await superCookie(api);
    const projects = await api.app.inject({
      method: "GET",
      url: "/api/v1/projects",
      headers: authHeaders(cookie),
    });
    expect(json(projects).projects).toHaveLength(2);
  });
});
