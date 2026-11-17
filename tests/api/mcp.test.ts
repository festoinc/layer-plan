import { afterEach, describe, expect, it } from "vitest";
import {
  authHeaders,
  createTestApi,
  docRequest,
  json,
  mcpCall,
  mcpRpc,
  TEST_SUPER_ADMIN,
  type TestApi,
} from "./helpers";

let api: TestApi | null = null;
afterEach(async () => {
  await api?.close();
  api = null;
});

const initialize = {
  protocolVersion: "2025-03-26",
  capabilities: {},
  clientInfo: { name: "test", version: "1" },
};

const projectTools = [
  "append_activity",
  "delete_project",
  "export_project",
  "get_coverage",
  "get_document",
  "get_project",
  "list_activity",
  "list_projects",
  "replace_document",
  "search_project",
  "update_project",
].sort();

async function superCookie(testApi: TestApi): Promise<string> {
  return (
    await testApi.login(TEST_SUPER_ADMIN.email, TEST_SUPER_ADMIN.password)
  ).cookie;
}

async function createProject(testApi: TestApi, cookie: string) {
  const response = await testApi.app.inject({
    method: "POST",
    url: "/api/v1/projects",
    ...docRequest({ name: "MCP project" }, authHeaders(cookie)),
  });
  expect(response.statusCode).toBe(201);
  return json(response) as { id: string };
}

describe("remote MCP", () => {
  it("advertises project-bound instructions and tools, enforces scopes and revisions", async () => {
    api = await createTestApi();
    const cookie = await superCookie(api);
    const read = await api.createToken(cookie, "website", { scopes: ["read"] });
    const write = await api.createToken(cookie, "website");
    const init = await mcpRpc(api, read, "initialize", initialize);
    expect(init.status).toBe(200);
    expect(init.body.result.instructions).toContain(
      "bound to exactly one project",
    );
    expect(init.body.result.instructions).toContain("confirm before deleting");
    expect(init.body.result.instructions).toContain(
      "createdSubchapters returned by replace_document",
    );
    expect(init.body.result.instructions).toContain(
      "Ask how to plan before writing",
    );
    expect(init.body.result.instructions).toContain("Whole project first");
    expect(init.body.result.instructions).toContain("Criterion by criterion");
    expect(init.body.result.instructions).toContain(
      "Chapter: I want authorization to work",
    );
    expect(init.body.result.instructions).toContain("one synchronized pair");
    expect(init.body.result.instructions).toContain("criterionSync");
    const list = await mcpRpc(api, read, "tools/list");
    const tools = list.body.result.tools as Array<{ name: string }>;
    expect(tools.map((tool) => tool.name).sort()).toEqual(projectTools);
    for (const excluded of [
      "create_project",
      "duplicate_project",
      "activate_project",
      "import_project",
    ]) {
      expect(tools.map((tool) => tool.name)).not.toContain(excluded);
    }

    const listed = await mcpCall(api, read, "list_projects");
    expect(listed.envelope.status).toBe(200);
    expect(
      listed.envelope.body.projects.map(
        (project: { id: string }) => project.id,
      ),
    ).toEqual(["website"]);

    const wrongProject = await mcpCall(api, read, "get_project", {
      projectId: "another-project",
    });
    expect(wrongProject.envelope.status).toBe(404);
    expect(wrongProject.envelope.body.error.code).toBe("not_found");

    const searched = await mcpCall(api, read, "search_project", {
      projectId: "website",
      q: "reset email",
      limit: 1,
    });
    expect(searched.envelope.status).toBe(200);
    expect(searched.envelope.etag).toBeNull();
    expect(searched.envelope.body.query).toBe("reset email");
    expect(searched.envelope.body.limit).toBe(1);
    expect(searched.envelope.body.results.length).toBe(1);
    expect(searched.envelope.body.results[0].chapterId).toBe("password-reset");

    const wrongSearch = await mcpCall(api, read, "search_project", {
      projectId: "another-project",
      q: "reset",
    });
    expect(wrongSearch.envelope.status).toBe(404);
    expect(wrongSearch.envelope.body.error.code).toBe("not_found");

    const denied = await mcpCall(api, read, "append_activity", {
      projectId: "website",
      body: {
        message: "Denied",
        chapterId: null,
        chapterName: "Website",
      },
    });
    expect(denied.envelope.status).toBe(403);

    const doc = (
      await mcpCall(api, read, "get_document", {
        projectId: "website",
      })
    ).envelope;
    const chapters = structuredClone(doc.body.chapters);
    chapters.byId["password-reset"].title = "Updated through MCP";
    const body = {
      chapters,
      selectedId: doc.body.selectedId,
    };
    const args = { projectId: "website", ifMatch: doc.etag, body };
    expect(
      (await mcpCall(api, write, "replace_document", args)).envelope.status,
    ).toBe(200);
    const conflict = await mcpCall(api, write, "replace_document", args);
    expect(conflict.envelope.status).toBe(412);
    expect(conflict.envelope.body.error.code).toBe("revision_conflict");
  });

  it("creates criterion subchapters on MCP document writes", async () => {
    api = await createTestApi();
    const cookie = await superCookie(api);
    const token = await api.createToken(cookie, "website");
    const doc = (
      await mcpCall(api, token, "get_document", {
        projectId: "website",
      })
    ).envelope;
    const chapters = structuredClone(doc.body.chapters);
    chapters.byId["password-reset"].criteria.push({
      id: "mcp-criterion",
      text: "Created through MCP",
      checked: false,
    });

    const result = await mcpCall(api, token, "replace_document", {
      projectId: "website",
      ifMatch: doc.etag,
      body: {
        chapters,
        selectedId: doc.body.selectedId,
      },
    });
    expect(result.envelope.status).toBe(200);
    expect(result.envelope.body.createdSubchapters).toHaveLength(1);
    const created = result.envelope.body.createdSubchapters[0];
    expect(created).toMatchObject({
      parentId: "password-reset",
      criterionId: "mcp-criterion",
      title: "Created through MCP",
    });
    expect(
      result.envelope.body.chapters.byId["password-reset"].criteria.find(
        (item: { id: string }) => item.id === "mcp-criterion",
      ).chapterId,
    ).toBe(created.id);
    expect(result.envelope.body.chapters.byId[created.id]).toMatchObject({
      parentId: "password-reset",
      title: "Created through MCP",
      description: "Created through MCP",
    });
    expect(
      result.envelope.body.activity.some(
        (event: { message: string }) =>
          event.message === "Created subchapter from success criterion",
      ),
    ).toBe(true);
  });

  it("keeps criteria and subchapters synchronized through MCP", async () => {
    api = await createTestApi();
    const cookie = await superCookie(api);
    const token = await api.createToken(cookie, "website");
    const doc = (
      await mcpCall(api, token, "get_document", {
        projectId: "website",
      })
    ).envelope;
    const chapters = structuredClone(doc.body.chapters);
    chapters.byId["password-reset"].criteria.push({
      id: "mcp-sync",
      text: "MCP sync",
      checked: false,
    });
    const created = await mcpCall(api, token, "replace_document", {
      projectId: "website",
      ifMatch: doc.etag,
      body: { chapters, selectedId: doc.body.selectedId },
    });
    expect(created.envelope.status).toBe(200);
    const subchapterId = created.envelope.body.createdSubchapters[0].id;

    const editedChapters = structuredClone(created.envelope.body.chapters);
    const editedParent = editedChapters.byId["password-reset"];
    const editedCriterion = editedParent.criteria.find(
      (item: { id: string }) => item.id === "mcp-sync",
    );
    editedCriterion.text = "MCP sync updated\n\nNew details.";
    const edited = await mcpCall(api, token, "replace_document", {
      projectId: "website",
      ifMatch: created.envelope.etag,
      body: {
        chapters: editedChapters,
        selectedId: created.envelope.body.selectedId,
      },
    });
    expect(edited.envelope.status).toBe(200);
    expect(edited.envelope.body.chapters.byId[subchapterId]).toMatchObject({
      title: "MCP sync updated",
      description: "MCP sync updated\n\nNew details.",
    });
    expect(edited.envelope.body.criterionSync.updatedSubchapters).toHaveLength(
      1,
    );

    const removedChapters = structuredClone(edited.envelope.body.chapters);
    removedChapters.byId["password-reset"].criteria = removedChapters.byId[
      "password-reset"
    ].criteria.filter((item: { id: string }) => item.id !== "mcp-sync");
    const removed = await mcpCall(api, token, "replace_document", {
      projectId: "website",
      ifMatch: edited.envelope.etag,
      body: {
        chapters: removedChapters,
        selectedId: edited.envelope.body.selectedId,
      },
    });
    expect(removed.envelope.status).toBe(200);
    expect(removed.envelope.body.chapters.byId[subchapterId]).toBeUndefined();
    expect(removed.envelope.body.criterionSync.removedSubchapters).toEqual([
      {
        id: subchapterId,
        parentId: "password-reset",
        criterionId: "mcp-sync",
        title: "MCP sync updated",
      },
    ]);
    expect(
      removed.envelope.body.activity.some(
        (event: { message: string }) =>
          event.message === "Deleted subchapter from success criterion",
      ),
    ).toBe(true);
  });

  it("isolates users and rejects cookies, bad hosts and forged internal auth", async () => {
    api = await createTestApi();
    const cookie = await superCookie(api);
    const alice = await api.createMember(cookie, {
      email: "mcp-alice@example.test",
    });
    const bob = await api.createMember(cookie, {
      email: "mcp-bob@example.test",
    });
    const aliceProject = await createProject(api, alice.cookie);
    const bobProject = await createProject(api, bob.cookie);
    const aliceToken = await api.createToken(alice.cookie, aliceProject.id);
    const bobToken = await api.createToken(bob.cookie, bobProject.id);

    const aliceList = await mcpCall(api, aliceToken, "list_projects");
    expect(
      aliceList.envelope.body.projects.map(
        (project: { id: string }) => project.id,
      ),
    ).toEqual([aliceProject.id]);

    expect(
      (
        await mcpCall(api, bobToken, "get_project", {
          projectId: aliceProject.id,
        })
      ).envelope.status,
    ).toBe(404);
    expect(
      (
        await mcpCall(api, aliceToken, "get_project", {
          projectId: bobProject.id,
        })
      ).envelope.status,
    ).toBe(404);

    const cookieOnly = await api.app.inject({
      method: "POST",
      url: "/mcp",
      headers: { host: "localhost", cookie },
      payload: {},
    });
    expect(cookieOnly.statusCode).toBe(401);
    const badHost = await api.app.inject({
      method: "POST",
      url: "/mcp",
      headers: { host: "evil.example", authorization: `Bearer ${aliceToken}` },
      payload: {},
    });
    expect(badHost.statusCode).toBe(403);
    const forged = await api.app.inject({
      method: "GET",
      url: "/api/v1/projects",
      headers: { "x-layers-internal-auth": "forged.context" },
    });
    expect(forged.statusCode).toBe(401);
    const forgedWithKey = await api.app.inject({
      method: "GET",
      url: "/api/v1/projects",
      headers: {
        authorization: `Bearer ${aliceToken}`,
        "x-layers-internal-auth": "forged.context",
      },
    });
    expect(forgedWithKey.statusCode).toBe(401);
  });

  it("supports the bound project lifecycle and revokes the key with the project", async () => {
    api = await createTestApi();
    const cookie = await superCookie(api);
    const token = await api.createToken(cookie, "website");

    const project = (
      await mcpCall(api, token, "get_project", {
        projectId: "website",
      })
    ).envelope;
    expect(project.status).toBe(200);
    const updated = await mcpCall(api, token, "update_project", {
      projectId: "website",
      ifMatch: project.etag,
      body: { description: "Updated through MCP" },
    });
    expect(updated.envelope.status).toBe(200);
    expect(updated.envelope.body.description).toBe("Updated through MCP");
    const stale = await mcpCall(api, token, "update_project", {
      projectId: "website",
      ifMatch: project.etag,
      body: { description: "Stale write" },
    });
    expect(stale.envelope.status).toBe(412);

    const appended = await mcpCall(api, token, "append_activity", {
      projectId: "website",
      body: {
        message: "MCP life cycle",
        chapterId: null,
        chapterName: "Website project",
      },
    });
    expect(appended.envelope.status).toBe(201);
    const activity = await mcpCall(api, token, "list_activity", {
      projectId: "website",
    });
    expect(activity.envelope.status).toBe(200);
    expect(
      activity.envelope.body.events.some(
        (event: { message: string }) => event.message === "MCP life cycle",
      ),
    ).toBe(true);
    expect(
      (await mcpCall(api, token, "get_coverage", { projectId: "website" }))
        .envelope.status,
    ).toBe(200);
    expect(
      (await mcpCall(api, token, "export_project", { projectId: "website" }))
        .envelope.status,
    ).toBe(200);

    const current = (
      await mcpCall(api, token, "get_project", {
        projectId: "website",
      })
    ).envelope;
    const removed = await mcpCall(api, token, "delete_project", {
      projectId: "website",
      ifMatch: current.etag,
    });
    expect(removed.envelope.status).toBe(200);
    const afterDelete = await mcpRpc(api, token, "initialize", initialize);
    expect(afterDelete.status).toBe(401);
  });
});
