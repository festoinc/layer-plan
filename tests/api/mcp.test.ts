import { afterEach, describe, expect, it } from "vitest";
import {
  authHeaders,
  createTestApi,
  docRequest,
  json,
  mcpCall,
  mcpCallRaw,
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
  "add_attachment",
  "create_root_chapter",
  "delete_attachment",
  "get_attachment",
  "get_coverage",
  "get_document",
  "get_project",
  "how_to_work_with_this_mcp",
  "list_activity",
  "list_attachments",
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
    expect(init.body.result.instructions).toContain("## How to plan");
    expect(init.body.result.instructions).toContain("not a PRD generator");
    expect(init.body.result.instructions).toContain("Bad — PRD categories");
    expect(init.body.result.instructions).toContain(
      "criterion → subchapter, finalLevel: true",
    );
    expect(init.body.result.instructions).toContain(
      "is the claim that the chapter is decomposed far enough",
    );
    expect(init.body.result.instructions).toContain(
      "One observable behaviour belongs in one criterion",
    );
    const list = await mcpRpc(api, read, "tools/list");
    const tools = list.body.result.tools as Array<{ name: string }>;
    expect(tools.map((tool) => tool.name).sort()).toEqual(projectTools);
    for (const excluded of [
      "create_project",
      "delete_project",
      "duplicate_project",
      "activate_project",
      "export_project",
      "import_project",
    ]) {
      expect(tools.map((tool) => tool.name)).not.toContain(excluded);
    }
    const deleteAttachment = tools.find(
      (tool) => tool.name === "delete_attachment",
    ) as { annotations?: { destructiveHint?: boolean } } | undefined;
    expect(deleteAttachment?.annotations?.destructiveHint).toBe(true);

    const guide = await mcpCallRaw(api, read, "how_to_work_with_this_mcp");
    expect(guide.isError).toBe(false);
    expect(guide.text).toContain("# Layers agent instructions");
    expect(guide.text).toContain("Ask how to plan before writing");
    expect(guide.text).toContain("criterionSync");

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

    const denied = await mcpCall(api, read, "update_project", {
      projectId: "website",
      ifMatch: '"1"',
      body: { description: "Denied" },
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

  it("creates a root chapter in one call and logs it", async () => {
    api = await createTestApi();
    const cookie = await superCookie(api);
    const read = await api.createToken(cookie, "website", { scopes: ["read"] });
    const write = await api.createToken(cookie, "website");

    const denied = await mcpCall(api, read, "create_root_chapter", {
      projectId: "website",
      title: "Denied",
    });
    expect(denied.envelope.status).toBe(403);

    const before = (
      await mcpCall(api, write, "get_document", { projectId: "website" })
    ).envelope;
    const created = await mcpCall(api, write, "create_root_chapter", {
      projectId: "website",
      title: "Agent chapters",
      description: "Chapters created over MCP.",
      finalLevel: true,
    });
    expect(created.envelope.status).toBe(201);
    const chapter = created.envelope.body.createdChapter;
    expect(chapter).toMatchObject({
      parentId: null,
      title: "Agent chapters",
      description: "Chapters created over MCP.",
      finalLevel: true,
      criteria: [],
      childIds: [],
    });
    expect(created.envelope.body.selectedId).toBe(chapter.id);
    expect(created.envelope.etag).toBe(`"${created.envelope.body.revision}"`);
    expect(created.envelope.body.revision).toBe(before.body.revision + 1);
    expect(created.envelope.body.stats.chapterCount).toBe(
      Object.keys(before.body.chapters.byId).length + 1,
    );

    const after = (
      await mcpCall(api, write, "get_document", { projectId: "website" })
    ).envelope;
    expect(after.body.chapters.rootIds).toEqual([
      ...before.body.chapters.rootIds,
      chapter.id,
    ]);
    expect(after.body.chapters.byId[chapter.id]).toMatchObject({
      title: "Agent chapters",
      parentId: null,
    });
    expect(Object.keys(after.body.chapters.byId).sort()).toEqual(
      [...Object.keys(before.body.chapters.byId), chapter.id].sort(),
    );

    const activity = await mcpCall(api, write, "list_activity", {
      projectId: "website",
    });
    expect(activity.envelope.body.events[0].message).toBe(
      'Added chapter "Agent chapters"',
    );
    expect(activity.envelope.body.events[0].chapterId).toBe(chapter.id);

    const wrongProject = await mcpCall(api, write, "create_root_chapter", {
      projectId: "another-project",
      title: "Nope",
    });
    expect(wrongProject.envelope.status).toBe(404);
  });

  it("adds, reads and deletes attachments with the write scope", async () => {
    api = await createTestApi();
    const cookie = await superCookie(api);
    const read = await api.createToken(cookie, "website", {
      scopes: ["read"],
    });
    const write = await api.createToken(cookie, "website");
    const pdf = Buffer.from("%PDF-1.4\n1 0 obj\n<<>>\nendobj\n%%EOF\n");
    const contentBase64 = pdf.toString("base64");

    const denied = await mcpCall(api, read, "add_attachment", {
      projectId: "website",
      filename: "denied.pdf",
      contentBase64,
    });
    expect(denied.envelope.status).toBe(403);

    const added = await mcpCall(api, write, "add_attachment", {
      projectId: "website",
      filename: "mcp-report.pdf",
      contentBase64,
    });
    expect(added.envelope.status).toBe(201);
    expect(added.envelope.body).toMatchObject({
      filename: "mcp-report.pdf",
      contentType: "application/pdf",
      projectId: "website",
    });
    const attachmentId = added.envelope.body.id as string;

    const listed = await mcpCall(api, read, "list_attachments", {
      projectId: "website",
    });
    expect(listed.envelope.status).toBe(200);
    expect(listed.envelope.body.maxAttachments).toBe(20);
    expect(
      listed.envelope.body.attachments.map(
        (attachment: { filename: string }) => attachment.filename,
      ),
    ).toContain("mcp-report.pdf");

    const content = await mcpCall(api, read, "get_attachment", {
      projectId: "website",
      attachmentId,
    });
    expect(content.envelope.status).toBe(200);
    expect(content.envelope.body.filename).toBe("mcp-report.pdf");
    expect(content.envelope.body.contentBase64).toBe(contentBase64);
    expect(content.envelope.etag).toBeNull();

    const missing = await mcpCall(api, read, "get_attachment", {
      projectId: "website",
      attachmentId: "missing-attachment",
    });
    expect(missing.envelope.status).toBe(404);

    const wrongProject = await mcpCall(api, read, "list_attachments", {
      projectId: "another-project",
    });
    expect(wrongProject.envelope.status).toBe(404);

    const deniedDelete = await mcpCall(api, read, "delete_attachment", {
      projectId: "website",
      attachmentId,
    });
    expect(deniedDelete.envelope.status).toBe(403);

    const removed = await mcpCall(api, write, "delete_attachment", {
      projectId: "website",
      attachmentId,
    });
    expect(removed.envelope.status).toBe(204);

    const afterDelete = await mcpCall(api, read, "list_attachments", {
      projectId: "website",
    });
    expect(afterDelete.envelope.body.attachments).toHaveLength(0);
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

    const activity = await mcpCall(api, token, "list_activity", {
      projectId: "website",
    });
    expect(activity.envelope.status).toBe(200);
    // The backend records the metadata change itself; agents no longer log it.
    expect(
      activity.envelope.body.events.some(
        (event: { message: string }) =>
          event.message === "Updated project settings",
      ),
    ).toBe(true);
    expect(
      (await mcpCall(api, token, "get_coverage", { projectId: "website" }))
        .envelope.status,
    ).toBe(200);

    const current = (
      await mcpCall(api, token, "get_project", {
        projectId: "website",
      })
    ).envelope;
    // Project export and deletion are REST-only: they are not MCP tools.
    const exported = await api.app.inject({
      method: "GET",
      url: "/api/v1/projects/website/export",
      headers: authHeaders(cookie),
    });
    expect(exported.statusCode).toBe(200);
    const removed = await api.app.inject({
      method: "DELETE",
      url: "/api/v1/projects/website",
      headers: { ...authHeaders(cookie), "if-match": current.etag },
    });
    expect(removed.statusCode).toBe(200);
    const afterDelete = await mcpRpc(api, token, "initialize", initialize);
    expect(afterDelete.status).toBe(401);
  });
});
