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

const PROJECT = "website";
const PARENT = "password-reset";
const CRITERION = "link-1";
const TEXT = "Reset email\n\nOne unique link.";

async function superCookie(testApi: TestApi): Promise<string> {
  return (
    await testApi.login(TEST_SUPER_ADMIN.email, TEST_SUPER_ADMIN.password)
  ).cookie;
}

async function getDocument(testApi: TestApi, cookie: string) {
  const response = await testApi.app.inject({
    method: "GET",
    url: `/api/v1/projects/${PROJECT}/document`,
    headers: authHeaders(cookie),
  });
  expect(response.statusCode).toBe(200);
  return { body: json(response), etag: response.headers.etag as string };
}

async function putDocument(
  testApi: TestApi,
  cookie: string,
  body: object,
  etag: string,
) {
  return testApi.app.inject({
    method: "PUT",
    url: `/api/v1/projects/${PROJECT}/document`,
    ...docRequest(body, { ...authHeaders(cookie), "if-match": etag }),
  });
}

async function createPair(testApi: TestApi, cookie: string) {
  const first = await getDocument(testApi, cookie);
  const parent = first.body.chapters.byId[PARENT];
  const chapters = {
    ...first.body.chapters,
    byId: {
      ...first.body.chapters.byId,
      [PARENT]: {
        ...parent,
        criteria: [
          ...parent.criteria,
          { id: CRITERION, text: TEXT, checked: false },
        ],
      },
    },
  };
  const response = await putDocument(
    testApi,
    cookie,
    { chapters, selectedId: first.body.selectedId },
    first.etag,
  );
  expect(response.statusCode).toBe(200);
  const body = json(response);
  expect(body.createdSubchapters).toHaveLength(1);
  return {
    body,
    etag: response.headers.etag as string,
    subchapterId: body.createdSubchapters[0].id as string,
  };
}

function criterionIn(body: any) {
  return body.chapters.byId[PARENT].criteria.find(
    (item: { id: string }) => item.id === CRITERION,
  );
}

function withoutCriterion(body: any) {
  const parent = body.chapters.byId[PARENT];
  return {
    ...body.chapters,
    byId: {
      ...body.chapters.byId,
      [PARENT]: {
        ...parent,
        criteria: parent.criteria.filter(
          (item: { id: string }) => item.id !== CRITERION,
        ),
      },
    },
  };
}

describe("criterion subchapter sync API", () => {
  it("creates once, mirrors a criterion edit and stays idempotent", async () => {
    api = await createTestApi();
    const cookie = await superCookie(api);
    const pair = await createPair(api, cookie);
    const subchapterId = pair.subchapterId;

    expect(pair.body.chapters.byId[subchapterId]).toMatchObject({
      parentId: PARENT,
      title: "Reset email",
      description: TEXT,
    });
    expect(criterionIn(pair.body).chapterId).toBe(subchapterId);

    const again = await putDocument(
      api,
      cookie,
      { chapters: pair.body.chapters, selectedId: pair.body.selectedId },
      pair.etag,
    );
    expect(again.statusCode).toBe(200);
    const againBody = json(again);
    expect(againBody.createdSubchapters).toEqual([]);
    expect(againBody.criterionSync).toEqual({
      updatedSubchapters: [],
      removedSubchapters: [],
      removedCriteria: [],
    });
    expect(againBody.revision).toBe(pair.body.revision);

    const chapters = structuredClone(pair.body.chapters);
    chapters.byId[PARENT].criteria = chapters.byId[PARENT].criteria.map(
      (item: { id: string }) =>
        item.id === CRITERION
          ? { ...item, text: "New title\n\nNew details." }
          : item,
    );
    const edited = await putDocument(
      api,
      cookie,
      { chapters, selectedId: pair.body.selectedId },
      pair.etag,
    );
    expect(edited.statusCode).toBe(200);
    const editedBody = json(edited);
    expect(editedBody.chapters.byId[subchapterId]).toMatchObject({
      title: "New title",
      description: "New title\n\nNew details.",
    });
    expect(editedBody.criterionSync.updatedSubchapters).toEqual([
      {
        id: subchapterId,
        parentId: PARENT,
        criterionId: CRITERION,
        title: "New title",
        description: "New title\n\nNew details.",
      },
    ]);

    const read = await getDocument(api, cookie);
    expect(read.body.chapters.byId[subchapterId].description).toBe(
      "New title\n\nNew details.",
    );
  });

  it("mirrors a subchapter description edit into the criterion", async () => {
    api = await createTestApi();
    const cookie = await superCookie(api);
    const pair = await createPair(api, cookie);
    const subchapterId = pair.subchapterId;

    const chapters = structuredClone(pair.body.chapters);
    chapters.byId[subchapterId].description = "Only the description changed.";
    const response = await putDocument(
      api,
      cookie,
      { chapters, selectedId: pair.body.selectedId },
      pair.etag,
    );
    expect(response.statusCode).toBe(200);
    const body = json(response);
    expect(criterionIn(body).text).toBe("Only the description changed.");
    expect(body.chapters.byId[subchapterId].title).toBe(
      "Only the description changed.",
    );
  });

  it("rewrites only the first line for a subchapter title edit", async () => {
    api = await createTestApi();
    const cookie = await superCookie(api);
    const pair = await createPair(api, cookie);
    const subchapterId = pair.subchapterId;

    const chapters = structuredClone(pair.body.chapters);
    chapters.byId[subchapterId].title = "New title";
    const response = await putDocument(
      api,
      cookie,
      { chapters, selectedId: pair.body.selectedId },
      pair.etag,
    );
    expect(response.statusCode).toBe(200);
    const body = json(response);
    expect(criterionIn(body).text).toBe("New title\n\nOne unique link.");
    expect(body.chapters.byId[subchapterId].description).toBe(
      "New title\n\nOne unique link.",
    );
  });

  it("deletes the subchapter subtree when the criterion is removed", async () => {
    api = await createTestApi();
    const cookie = await superCookie(api);
    const pair = await createPair(api, cookie);
    const subchapterId = pair.subchapterId;

    const response = await putDocument(
      api,
      cookie,
      {
        chapters: withoutCriterion(pair.body),
        selectedId: pair.body.selectedId,
      },
      pair.etag,
    );
    expect(response.statusCode).toBe(200);
    const body = json(response);
    expect(body.chapters.byId[subchapterId]).toBeUndefined();
    expect(
      body.chapters.byId[PARENT].criteria.map(
        (item: { id: string }) => item.id,
      ),
    ).not.toContain(CRITERION);
    expect(body.criterionSync.removedSubchapters).toEqual([
      {
        id: subchapterId,
        parentId: PARENT,
        criterionId: CRITERION,
        title: "Reset email",
      },
    ]);
    expect(
      body.activity.some(
        (event: { message: string }) =>
          event.message === "Deleted subchapter from success criterion",
      ),
    ).toBe(true);

    const read = await getDocument(api, cookie);
    expect(read.body.chapters.byId[subchapterId]).toBeUndefined();
    const coverage = await api.app.inject({
      method: "GET",
      url: `/api/v1/projects/${PROJECT}/coverage`,
      headers: authHeaders(cookie),
    });
    expect(coverage.statusCode).toBe(200);
    expect(
      json(coverage).rows.some(
        (row: { chapterId: string }) => row.chapterId === subchapterId,
      ),
    ).toBe(false);
  });

  it("deletes the criterion when the subchapter is removed", async () => {
    api = await createTestApi();
    const cookie = await superCookie(api);
    const pair = await createPair(api, cookie);
    const subchapterId = pair.subchapterId;

    const chapters = structuredClone(pair.body.chapters);
    delete chapters.byId[subchapterId];
    chapters.byId[PARENT].childIds = chapters.byId[PARENT].childIds.filter(
      (id: string) => id !== subchapterId,
    );
    const response = await putDocument(
      api,
      cookie,
      { chapters, selectedId: pair.body.selectedId },
      pair.etag,
    );
    expect(response.statusCode).toBe(200);
    const body = json(response);
    expect(body.chapters.byId[subchapterId]).toBeUndefined();
    expect(criterionIn(body)).toBeUndefined();
    expect(body.criterionSync.removedCriteria).toEqual([
      { chapterId: PARENT, criterionId: CRITERION, text: TEXT },
    ]);
  });

  it("detaches when only the chapterId is removed", async () => {
    api = await createTestApi();
    const cookie = await superCookie(api);
    const pair = await createPair(api, cookie);
    const subchapterId = pair.subchapterId;

    const chapters = structuredClone(pair.body.chapters);
    chapters.byId[PARENT].criteria = chapters.byId[PARENT].criteria.map(
      (item: { id: string; chapterId?: string }) => {
        if (item.id !== CRITERION) return item;
        const { chapterId: _chapterId, ...rest } = item;
        return rest;
      },
    );
    const response = await putDocument(
      api,
      cookie,
      { chapters, selectedId: pair.body.selectedId },
      pair.etag,
    );
    expect(response.statusCode).toBe(200);
    const body = json(response);
    expect(criterionIn(body)).toBeDefined();
    expect(criterionIn(body).chapterId).toBeUndefined();
    expect(body.chapters.byId[subchapterId]).toMatchObject({
      parentId: PARENT,
      title: "Reset email",
    });
    expect(body.criterionSync.removedSubchapters).toEqual([]);
    expect(body.criterionSync.removedCriteria).toEqual([]);
  });

  it("detaches instead of deleting when the subchapter is moved", async () => {
    api = await createTestApi();
    const cookie = await superCookie(api);
    const pair = await createPair(api, cookie);
    const subchapterId = pair.subchapterId;

    const chapters = structuredClone(pair.body.chapters);
    chapters.byId[PARENT].childIds = chapters.byId[PARENT].childIds.filter(
      (id: string) => id !== subchapterId,
    );
    chapters.byId[subchapterId].parentId = "authentication";
    chapters.byId["authentication"].childIds = [
      ...chapters.byId["authentication"].childIds,
      subchapterId,
    ];
    const response = await putDocument(
      api,
      cookie,
      { chapters, selectedId: pair.body.selectedId },
      pair.etag,
    );
    expect(response.statusCode).toBe(200);
    const body = json(response);
    expect(body.chapters.byId[subchapterId].parentId).toBe("authentication");
    expect(criterionIn(body)).toBeDefined();
    expect(criterionIn(body).chapterId).toBeUndefined();
    expect(body.criterionSync.removedSubchapters).toEqual([]);
  });

  it("falls back from a selected chapter deleted by the cascade", async () => {
    api = await createTestApi();
    const cookie = await superCookie(api);
    const pair = await createPair(api, cookie);

    const response = await putDocument(
      api,
      cookie,
      {
        chapters: withoutCriterion(pair.body),
        selectedId: pair.subchapterId,
      },
      pair.etag,
    );
    expect(response.statusCode).toBe(200);
    const body = json(response);
    expect(body.chapters.byId[pair.subchapterId]).toBeUndefined();
    expect(body.selectedId).toBe("authentication");
  });

  it("still rejects unknown selected ids and stale revisions", async () => {
    api = await createTestApi();
    const cookie = await superCookie(api);
    const before = await getDocument(api, cookie);
    const pair = await createPair(api, cookie);

    const unknown = await putDocument(
      api,
      cookie,
      { chapters: pair.body.chapters, selectedId: "does-not-exist" },
      pair.etag,
    );
    expect(unknown.statusCode).toBe(422);

    const stale = await putDocument(
      api,
      cookie,
      { chapters: pair.body.chapters, selectedId: pair.body.selectedId },
      before.etag,
    );
    expect(stale.statusCode).toBe(412);
    expect(json(stale).error.code).toBe("revision_conflict");
  });

  it("does not create subchapters for final-level chapters", async () => {
    api = await createTestApi();
    const cookie = await superCookie(api);
    const first = await getDocument(api, cookie);
    const parent = first.body.chapters.byId[PARENT];
    const chapters = {
      ...first.body.chapters,
      byId: {
        ...first.body.chapters.byId,
        [PARENT]: {
          ...parent,
          finalLevel: true,
          criteria: [
            ...parent.criteria,
            { id: "final-criterion", text: "Stays here", checked: false },
          ],
        },
      },
    };
    const response = await putDocument(
      api,
      cookie,
      { chapters, selectedId: first.body.selectedId },
      first.etag,
    );
    expect(response.statusCode).toBe(200);
    const body = json(response);
    expect(body.createdSubchapters).toEqual([]);
    expect(
      body.chapters.byId[PARENT].criteria.find(
        (item: { id: string }) => item.id === "final-criterion",
      ).chapterId,
    ).toBeUndefined();
  });
});
