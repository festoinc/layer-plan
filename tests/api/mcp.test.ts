import { afterEach, describe, expect, it } from "vitest";
import { createTestApi, TEST_SUPER_ADMIN, type TestApi } from "./helpers";

let api: TestApi | null = null;
afterEach(async () => {
  await api?.close();
  api = null;
});

async function rpc(token: string, method: string, params: object = {}) {
  const response = await api!.app.inject({
    method: "POST",
    url: "/mcp",
    headers: {
      authorization: `Bearer ${token}`,
      accept: "application/json, text/event-stream",
      "content-type": "application/json",
      host: "localhost",
    },
    payload: { jsonrpc: "2.0", id: 1, method, params },
  });
  return { status: response.statusCode, body: JSON.parse(response.payload) };
}
async function call(token: string, name: string, args: object = {}) {
  const result = await rpc(token, "tools/call", { name, arguments: args });
  return {
    ...result,
    envelope: JSON.parse(result.body.result.content[0].text),
  };
}

describe("remote MCP", () => {
  it("advertises instructions and fixed tools, enforces scopes and preserves revisions", async () => {
    api = await createTestApi();
    const { cookie } = await api.login(
      TEST_SUPER_ADMIN.email,
      TEST_SUPER_ADMIN.password,
    );
    const read = await api.createToken(cookie, { scopes: ["read"] });
    const write = await api.createToken(cookie, { scopes: ["read", "write"] });
    const init = await rpc(read, "initialize", {
      protocolVersion: "2025-03-26",
      capabilities: {},
      clientInfo: { name: "test", version: "1" },
    });
    expect(init.status).toBe(200);
    expect(init.body.result.instructions).toContain("confirm before deleting");
    const list = await rpc(read, "tools/list");
    expect(
      list.body.result.tools.map((tool: { name: string }) => tool.name),
    ).toContain("replace_document");
    expect(list.body.result.tools).toHaveLength(14);
    expect(
      (await call(read, "create_project", { body: { name: "no" } })).envelope
        .status,
    ).toBe(403);
    const created = await call(write, "create_project", {
      body: { name: "MCP test" },
    });
    expect(created.envelope.status).toBe(201);
    const doc = (await call(read, "get_document", { projectId: "website" }))
      .envelope;
    const chapters = structuredClone(doc.body.chapters);
    chapters.byId["password-reset"].title = "Updated through MCP";
    const body = {
      chapters,
      selectedId: doc.body.selectedId,
    };
    const args = { projectId: "website", ifMatch: doc.etag, body };
    expect((await call(write, "replace_document", args)).envelope.status).toBe(
      200,
    );
    const conflict = await call(write, "replace_document", args);
    expect(conflict.envelope.status).toBe(412);
    expect(conflict.envelope.body.error.code).toBe("revision_conflict");
  });

  it("isolates users and rejects cookies and unexpected hosts", async () => {
    api = await createTestApi();
    const { cookie } = await api.login(
      TEST_SUPER_ADMIN.email,
      TEST_SUPER_ADMIN.password,
    );
    const alice = await api.createMember(cookie, {
      email: "alice@example.test",
    });
    const bob = await api.createMember(cookie, { email: "bob@example.test" });
    const aliceToken = await api.createToken(alice.cookie, {
      scopes: ["read", "write"],
    });
    const bobToken = await api.createToken(bob.cookie, {
      scopes: ["read", "write"],
    });
    const project = await call(aliceToken, "create_project", {
      body: { name: "private" },
    });
    expect(
      (
        await call(bobToken, "get_project", {
          projectId: project.envelope.body.id,
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
  });
});
