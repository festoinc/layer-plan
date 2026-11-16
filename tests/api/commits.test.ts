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

const short = "4f2a9c1";
const full = "9d0be7a1c2f34d5e6f708192a3b4c5d6e7f80912";

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

function withCommits(
  body: any,
  commits: unknown,
  chapterId = "password-reset",
) {
  return {
    ...body.chapters,
    byId: {
      ...body.chapters.byId,
      [chapterId]: {
        ...body.chapters.byId[chapterId],
        commits,
      },
    },
  };
}

async function saveCommits(
  testApi: TestApi,
  cookie: string,
  commits: unknown,
  options: { chapterId?: string } = {},
) {
  const first = await getDocument(testApi, cookie);
  return testApi.app.inject({
    method: "PUT",
    url: "/api/v1/projects/website/document",
    headers: {
      ...authHeaders(cookie),
      "content-type": "application/json",
      "if-match": first.etag,
    },
    payload: {
      chapters: withCommits(first.body, commits, options.chapterId),
      selectedId: first.body.selectedId,
    },
  });
}

describe("commit API", () => {
  it("defaults to empty commit lists and returns them on every chapter", async () => {
    api = await createTestApi();
    const cookie = await superCookie(api);
    const first = await getDocument(api, cookie);
    for (const chapter of Object.values(first.body.chapters.byId) as any[]) {
      expect(chapter.commits).toEqual([]);
    }
  });

  it("stores short, full and uppercase hashes as lowercase, newest first", async () => {
    api = await createTestApi();
    const cookie = await superCookie(api);
    const saved = await saveCommits(api, cookie, [full.toUpperCase(), short]);
    expect(saved.statusCode).toBe(200);
    const body = json(saved);
    expect(body.chapters.byId["password-reset"].commits).toEqual([full, short]);
    expect(body.revision).toBe(2);

    const reloaded = await getDocument(api, cookie);
    expect(reloaded.body.chapters.byId["password-reset"].commits).toEqual([
      full,
      short,
    ]);
  });

  it("deduplicates commits within one request", async () => {
    api = await createTestApi();
    const cookie = await superCookie(api);
    const saved = await saveCommits(api, cookie, [short, "4F2A9C1"]);
    expect(saved.statusCode).toBe(200);
    expect(json(saved).chapters.byId["password-reset"].commits).toEqual([
      short,
    ]);
  });

  it.each([
    ["too short", "abc123"],
    ["not hexadecimal", "not-a-hash"],
    ["too long", "a".repeat(41)],
    ["empty", ""],
    ["not a string", 1234567],
  ])("rejects a hash that is %s", async (_label, value) => {
    api = await createTestApi();
    const cookie = await superCookie(api);
    const saved = await saveCommits(api, cookie, [value]);
    expect(saved.statusCode).toBe(422);
    const body = json(saved);
    expect(body.error.code).toBe("validation_failed");
    expect(body.error.details[0].path).toContain("commits.0");
  });

  it("rejects a commit list above the limit", async () => {
    api = await createTestApi();
    const cookie = await superCookie(api);
    const values = Array.from({ length: 51 }, (_, index) =>
      index.toString(16).padStart(7, "0"),
    );
    const saved = await saveCommits(api, cookie, values);
    expect(saved.statusCode).toBe(422);
    expect(json(saved).error.code).toBe("validation_failed");
  });

  it("records linking and removing commits in activity", async () => {
    api = await createTestApi();
    const cookie = await superCookie(api);
    const first = await getDocument(api, cookie);
    const chapters = withCommits(first.body, [short]);
    const linked = await api.app.inject({
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
            id: "commit-linked",
            message: `Linked commit ${short}`,
            chapterId: "password-reset",
            chapterName: "Reset password",
          },
        ],
      },
    });
    expect(linked.statusCode).toBe(200);
    expect(json(linked).activity[0].message).toBe(`Linked commit ${short}`);
    expect(json(linked).activity[0].actorName).toBe("Super Admin");

    const afterLink = await getDocument(api, cookie);
    const removed = await api.app.inject({
      method: "PUT",
      url: "/api/v1/projects/website/document",
      headers: {
        ...authHeaders(cookie),
        "content-type": "application/json",
        "if-match": afterLink.etag,
      },
      payload: {
        chapters: withCommits(afterLink.body, []),
        selectedId: afterLink.body.selectedId,
        activity: [
          {
            id: "commit-removed",
            message: `Removed commit ${short}`,
            chapterId: "password-reset",
            chapterName: "Reset password",
          },
        ],
      },
    });
    expect(removed.statusCode).toBe(200);
    expect(json(removed).chapters.byId["password-reset"].commits).toEqual([]);
    expect(json(removed).activity[0].message).toBe(`Removed commit ${short}`);
  });

  it("returns commits from the coverage endpoint", async () => {
    api = await createTestApi();
    const cookie = await superCookie(api);
    const first = await getDocument(api, cookie);
    await api.app.inject({
      method: "PUT",
      url: "/api/v1/projects/website/document",
      headers: {
        ...authHeaders(cookie),
        "content-type": "application/json",
        "if-match": first.etag,
      },
      payload: {
        chapters: withCommits(first.body, [short, full], "password-reset"),
        selectedId: first.body.selectedId,
      },
    });

    const response = await api.app.inject({
      method: "GET",
      url: "/api/v1/projects/website/coverage",
      headers: authHeaders(cookie),
    });
    expect(response.statusCode).toBe(200);
    const row = json(response).rows.find(
      (item: any) => item.chapterId === "password-reset",
    );
    expect(row.commits).toEqual([short, full]);
  });

  it("exports commits and imports them back", async () => {
    api = await createTestApi();
    const cookie = await superCookie(api);
    await saveCommits(api, cookie, [short, full]);

    const exported = await api.app.inject({
      method: "GET",
      url: "/api/v1/projects/website/export",
      headers: authHeaders(cookie),
    });
    expect(exported.statusCode).toBe(200);
    const payload = json(exported);
    expect(payload.formatVersion).toBe(4);
    expect(payload.chapters.byId["password-reset"].commits).toEqual([
      short,
      full,
    ]);
    expect(payload.instructions).toContain("commits");

    const imported = await api.app.inject({
      method: "POST",
      url: "/api/v1/projects/import",
      ...docRequest(payload, authHeaders(cookie)),
    });
    expect(imported.statusCode).toBe(201);
    const document = await getDocument(api, cookie, json(imported).project.id);
    expect(document.body.chapters.byId["password-reset"].commits).toEqual([
      short,
      full,
    ]);
  });

  it("imports a version 3 export without commits", async () => {
    api = await createTestApi();
    const cookie = await superCookie(api);
    const exported = json(
      await api.app.inject({
        method: "GET",
        url: "/api/v1/projects/website/export",
        headers: authHeaders(cookie),
      }),
    );
    exported.formatVersion = 3;
    for (const chapter of Object.values(exported.chapters.byId) as any[]) {
      delete chapter.commits;
    }

    const imported = await api.app.inject({
      method: "POST",
      url: "/api/v1/projects/import",
      ...docRequest(exported, authHeaders(cookie)),
    });
    expect(imported.statusCode).toBe(201);
    const document = await getDocument(api, cookie, json(imported).project.id);
    for (const chapter of Object.values(document.body.chapters.byId) as any[]) {
      expect(chapter.commits).toEqual([]);
    }
  });

  it("enforces ownership and token scopes", async () => {
    api = await createTestApi();
    const cookie = await superCookie(api);
    const member = await api.createMember(cookie);
    const foreign = await api.app.inject({
      method: "GET",
      url: "/api/v1/projects/website/document",
      headers: authHeaders(member.cookie),
    });
    expect(foreign.statusCode).toBe(404);

    const readToken = await api.createToken(cookie, "website", {
      name: "Read only",
      scopes: ["read"],
    });
    const first = await mcpCall(api, readToken, "get_document", {
      projectId: "website",
    });
    const denied = await mcpCall(api, readToken, "replace_document", {
      projectId: "website",
      ifMatch: first.envelope.etag,
      body: {
        chapters: withCommits(first.envelope.body, [short]),
        selectedId: first.envelope.body.selectedId,
      },
    });
    expect(denied.envelope.status).toBe(403);
  });
});
