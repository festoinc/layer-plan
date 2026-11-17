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

async function saveCommit(testApi: TestApi, cookie: string, hash = "4f2a9c1") {
  const current = await getDocument(testApi, cookie);
  const chapters = structuredClone(current.body.chapters);
  chapters.byId["password-reset"].commits = [hash];
  const response = await testApi.app.inject({
    method: "PUT",
    url: "/api/v1/projects/website/document",
    headers: {
      ...authHeaders(cookie),
      "content-type": "application/json",
      "if-match": current.etag,
    },
    payload: { chapters, selectedId: current.body.selectedId },
  });
  expect(response.statusCode).toBe(200);
}

async function search(
  testApi: TestApi,
  cookie: string,
  params: Record<string, string | number> = {},
  projectId = "website",
) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    query.set(key, String(value));
  }
  const suffix = query.toString();
  const response = await testApi.app.inject({
    method: "GET",
    url: `/api/v1/projects/${projectId}/search${suffix ? `?${suffix}` : ""}`,
    headers: authHeaders(cookie),
  });
  return { response, body: json(response) };
}

describe("project search API", () => {
  it("searches one project and returns ranked chapter results", async () => {
    api = await createTestApi();
    const cookie = await superCookie(api);
    const document = await getDocument(api, cookie);

    const { response, body } = await search(api, cookie, {
      q: "password reset",
    });
    expect(response.statusCode).toBe(200);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(body.projectId).toBe("website");
    expect(body.query).toBe("password reset");
    expect(body.documentRevision).toBe(document.body.revision);
    expect(body.offset).toBe(0);
    expect(body.limit).toBe(20);
    expect(body.truncated).toBe(false);
    expect(body.total).toBeGreaterThan(0);

    const reset = body.results.find(
      (item: { chapterId: string }) => item.chapterId === "password-reset",
    );
    expect(reset).toBeTruthy();
    expect(reset.path.map((item: { id: string }) => item.id)).toEqual([
      "authentication",
      "password-reset",
    ]);
    expect(
      reset.matches.map((match: { field: string }) => match.field),
    ).toEqual(expect.arrayContaining(["title", "criterion"]));
    for (const match of reset.matches) {
      expect(match.ranges.length).toBeGreaterThan(0);
      expect(match.snippet.length).toBeLessThanOrEqual(162);
    }
  });

  it("matches verification text and commit prefixes", async () => {
    api = await createTestApi();
    const cookie = await superCookie(api);

    const verification = await search(api, cookie, {
      q: "npm test login:test-ok",
    });
    expect(verification.response.statusCode).toBe(200);
    const login = verification.body.results.find(
      (item: { chapterId: string }) => item.chapterId === "login",
    );
    expect(login.matches[0].field).toBe("verification.auto");

    await saveCommit(api, cookie);
    const commit = await search(api, cookie, { q: "4F2A" });
    expect(commit.response.statusCode).toBe(200);
    const reset = commit.body.results.find(
      (item: { chapterId: string }) => item.chapterId === "password-reset",
    );
    expect(reset.matches[0]).toMatchObject({
      field: "commit",
      commit: "4f2a9c1",
      ranges: [[0, 4]],
    });
  });

  it("requires all terms and returns an empty result set when nothing matches", async () => {
    api = await createTestApi();
    const cookie = await superCookie(api);

    const both = await search(api, cookie, { q: "reset smtp" });
    expect(both.response.statusCode).toBe(200);
    expect(
      both.body.results.map((item: { chapterId: string }) => item.chapterId),
    ).toContain("smtp");

    const none = await search(api, cookie, { q: "reset zzz-not-present" });
    expect(none.response.statusCode).toBe(200);
    expect(none.body).toMatchObject({
      total: 0,
      truncated: false,
      results: [],
    });
  });

  it("normalizes the query and paginates by offset", async () => {
    api = await createTestApi();
    const cookie = await superCookie(api);

    const normalized = await search(api, cookie, {
      q: "  reset   email  ",
    });
    expect(normalized.body.query).toBe("reset email");

    const first = await search(api, cookie, { q: "reset", limit: 1 });
    const second = await search(api, cookie, {
      q: "reset",
      limit: 1,
      offset: 1,
    });
    expect(first.body.total).toBeGreaterThan(1);
    expect(first.body.results).toHaveLength(1);
    expect(second.body.results).toHaveLength(1);
    expect(second.body.results[0].chapterId).not.toBe(
      first.body.results[0].chapterId,
    );
    expect(second.body.total).toBe(first.body.total);
  });

  it.each([
    ["missing q", {}],
    ["short q", { q: "a" }],
    ["long q", { q: "x".repeat(201) }],
    ["zero limit", { q: "reset", limit: 0 }],
    ["large limit", { q: "reset", limit: 101 }],
    ["negative offset", { q: "reset", offset: -1 }],
    ["unknown filter", { q: "reset", field: "title" }],
  ])("rejects %s", async (_label, params) => {
    api = await createTestApi();
    const cookie = await superCookie(api);
    const { response, body } = await search(api, cookie, params);
    expect(response.statusCode).toBe(422);
    expect(body.error.code).toBe("validation_failed");
  });

  it("requires authentication and project ownership", async () => {
    api = await createTestApi();
    const cookie = await superCookie(api);

    const unauthenticated = await api.app.inject({
      method: "GET",
      url: "/api/v1/projects/website/search?q=reset",
    });
    expect(unauthenticated.statusCode).toBe(401);

    const missing = await search(
      api,
      cookie,
      { q: "reset" },
      "missing-project",
    );
    expect(missing.response.statusCode).toBe(404);
    expect(missing.body.error.code).toBe("not_found");

    const member = await api.createMember(cookie, {
      email: "search-member@example.test",
    });
    const foreign = await search(api, member.cookie, { q: "reset" });
    expect(foreign.response.statusCode).toBe(404);
    expect(foreign.body.error.code).toBe("not_found");
  });

  it("does not change the document revision, ETag or activity", async () => {
    api = await createTestApi();
    const cookie = await superCookie(api);
    const before = await getDocument(api, cookie);
    const beforeActivity = await api.app.inject({
      method: "GET",
      url: "/api/v1/projects/website/activity",
      headers: authHeaders(cookie),
    });
    const beforeEvents = json(beforeActivity).events;

    const { response } = await search(api, cookie, { q: "reset" });
    expect(response.statusCode).toBe(200);

    const after = await getDocument(api, cookie);
    const afterActivity = await api.app.inject({
      method: "GET",
      url: "/api/v1/projects/website/activity",
      headers: authHeaders(cookie),
    });
    expect(after.body.revision).toBe(before.body.revision);
    expect(after.etag).toBe(before.etag);
    expect(json(afterActivity).events).toEqual(beforeEvents);
  });

  it("rate limits repeated search requests", async () => {
    api = await createTestApi();
    const cookie = await superCookie(api);

    for (let index = 0; index < 120; index += 1) {
      const { response } = await search(api, cookie, { q: "reset" });
      expect(response.statusCode).toBe(200);
    }
    const limited = await search(api, cookie, { q: "reset" });
    expect(limited.response.statusCode).toBe(429);
    expect(limited.body.error.code).toBe("rate_limited");
  });

  it("searches only the requested project", async () => {
    api = await createTestApi();
    const cookie = await superCookie(api);
    const created = await api.app.inject({
      method: "POST",
      url: "/api/v1/projects",
      ...docRequest({ name: "Password reset" }, authHeaders(cookie)),
    });
    expect(created.statusCode).toBe(201);
    const otherId = json(created).id;

    const { body } = await search(
      api,
      cookie,
      { q: "password reset" },
      otherId,
    );
    expect(body.projectId).toBe(otherId);
    expect(body.total).toBe(0);
    expect(body.results).toEqual([]);
  });
});
