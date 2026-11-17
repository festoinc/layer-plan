import path from "node:path";
import SwaggerParser from "@apidevtools/swagger-parser";
import Ajv, { type ValidateFunction } from "ajv";
import addFormats from "ajv-formats";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  authHeaders,
  createTestApi,
  docRequest,
  json,
  TEST_SUPER_ADMIN,
  type TestApi,
} from "../api/helpers";

const specPath = path.resolve("server/api/openapi.yaml");
const ajv = new Ajv({ strict: false, allErrors: true });
addFormats(ajv);

let apiDoc: any;
let api: TestApi;
let superCookie: string;

function schemaAt(pathKey: string, method: string, status: string) {
  return apiDoc.paths[pathKey][method].responses[status].content[
    "application/json"
  ].schema;
}

function validator(schema: unknown): ValidateFunction {
  return ajv.compile(schema as object);
}

function expectValid(schema: unknown, value: unknown, label: string) {
  const validate = validator(schema);
  const valid = validate(value);
  expect(valid, `${label}: ${JSON.stringify(validate.errors)}`).toBe(true);
}

beforeAll(async () => {
  await SwaggerParser.validate(specPath);
  apiDoc = await SwaggerParser.dereference(specPath);
  api = await createTestApi();
  superCookie = (
    await api.login(TEST_SUPER_ADMIN.email, TEST_SUPER_ADMIN.password)
  ).cookie;
});

afterAll(async () => {
  await api?.close();
});

const expectedPaths = [
  "/health",
  "/openapi.json",
  "/auth/login",
  "/auth/logout",
  "/auth/session",
  "/auth/sessions",
  "/auth/sessions/{sessionId}",
  "/me",
  "/me/password",
  "/users",
  "/users/{userId}",
  "/projects",
  "/projects/{projectId}",
  "/projects/{projectId}/activate",
  "/projects/{projectId}/activity",
  "/projects/{projectId}/coverage",
  "/projects/{projectId}/document",
  "/projects/{projectId}/duplicate",
  "/projects/{projectId}/export",
  "/projects/{projectId}/tokens",
  "/projects/{projectId}/tokens/{tokenId}",
  "/projects/import",
].sort();

describe("OpenAPI contract", () => {
  it("documents every REST route and the session security scheme", () => {
    expect(Object.keys(apiDoc.paths).sort()).toEqual(expectedPaths);
    expect(apiDoc.components.securitySchemes.sessionCookie).toMatchObject({
      type: "apiKey",
      in: "cookie",
      name: "layers_session",
    });
    expect(apiDoc.components.securitySchemes.bearerAuth).toBeUndefined();
    expect(apiDoc.security).toEqual([{ sessionCookie: [] }]);
  });

  it("marks public routes and documents 401/403 on protected routes", () => {
    for (const [pathKey, method] of [
      ["/health", "get"],
      ["/openapi.json", "get"],
      ["/auth/login", "post"],
      ["/auth/logout", "post"],
    ] as const) {
      expect(apiDoc.paths[pathKey][method].security).toEqual([]);
    }
    for (const pathKey of Object.keys(apiDoc.paths)) {
      for (const [method, operation] of Object.entries<any>(
        apiDoc.paths[pathKey],
      )) {
        if (!["get", "post", "patch", "put", "delete"].includes(method)) {
          continue;
        }
        const isPublic =
          (pathKey === "/health" && method === "get") ||
          (pathKey === "/openapi.json" && method === "get") ||
          (pathKey === "/auth/login" && method === "post") ||
          (pathKey === "/auth/logout" && method === "post");
        if (isPublic) continue;
        expect(
          operation.responses["401"],
          `${method} ${pathKey} 401`,
        ).toBeTruthy();
        expect(
          operation.responses["403"],
          `${method} ${pathKey} 403`,
        ).toBeTruthy();
      }
    }
  });

  it("matches the auth, session and user responses", async () => {
    const login = await api.app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      payload: {
        email: TEST_SUPER_ADMIN.email,
        password: TEST_SUPER_ADMIN.password,
      },
      headers: { "content-type": "application/json" },
    });
    expect(login.statusCode).toBe(200);
    expectValid(schemaAt("/auth/login", "post", "200"), json(login), "login");

    const session = await api.app.inject({
      method: "GET",
      url: "/api/v1/auth/session",
      headers: authHeaders(superCookie),
    });
    expectValid(
      schemaAt("/auth/session", "get", "200"),
      json(session),
      "session",
    );

    const me = await api.app.inject({
      method: "GET",
      url: "/api/v1/me",
      headers: authHeaders(superCookie),
    });
    expectValid(schemaAt("/me", "get", "200"), json(me), "me");

    const changedPassword = await api.app.inject({
      method: "POST",
      url: "/api/v1/me/password",
      ...docRequest(
        {
          currentPassword: TEST_SUPER_ADMIN.password,
          newPassword: "contract-super-admin-password",
        },
        authHeaders(superCookie),
      ),
    });
    expect(changedPassword.statusCode).toBe(204);

    const sessions = await api.app.inject({
      method: "GET",
      url: "/api/v1/auth/sessions",
      headers: authHeaders(superCookie),
    });
    expectValid(
      schemaAt("/auth/sessions", "get", "200"),
      json(sessions),
      "sessions",
    );

    const users = await api.app.inject({
      method: "GET",
      url: "/api/v1/users",
      headers: authHeaders(superCookie),
    });
    expectValid(schemaAt("/users", "get", "200"), json(users), "users");

    const createdUser = await api.app.inject({
      method: "POST",
      url: "/api/v1/users",
      ...docRequest(
        {
          email: `contract-${Date.now()}@example.test`,
          password: "a-long-member-password",
          displayName: "Contract User",
        },
        authHeaders(superCookie),
      ),
    });
    expect(createdUser.statusCode).toBe(201);
    expectValid(
      schemaAt("/users", "post", "201"),
      json(createdUser),
      "create user",
    );

    const tokens = await api.app.inject({
      method: "GET",
      url: "/api/v1/projects/website/tokens",
      headers: authHeaders(superCookie),
    });
    expectValid(
      schemaAt("/projects/{projectId}/tokens", "get", "200"),
      json(tokens),
      "tokens",
    );

    const createdToken = await api.app.inject({
      method: "POST",
      url: "/api/v1/projects/website/tokens",
      ...docRequest(
        { name: "Contract key", scopes: ["read"] },
        authHeaders(superCookie),
      ),
    });
    expect(createdToken.statusCode).toBe(201);
    expectValid(
      schemaAt("/projects/{projectId}/tokens", "post", "201"),
      json(createdToken),
      "create token",
    );
  });

  it("matches the catalog responses", async () => {
    const response = await api.app.inject({
      method: "GET",
      url: "/api/v1/projects",
      headers: authHeaders(superCookie),
    });
    expect(response.statusCode).toBe(200);
    expectValid(schemaAt("/projects", "get", "200"), json(response), "catalog");

    const detail = await api.app.inject({
      method: "GET",
      url: "/api/v1/projects/website",
      headers: authHeaders(superCookie),
    });
    expect(detail.statusCode).toBe(200);
    expectValid(
      schemaAt("/projects/{projectId}", "get", "200"),
      json(detail),
      "project detail",
    );
  });

  it("matches document, activity and coverage responses", async () => {
    const document = await api.app.inject({
      method: "GET",
      url: "/api/v1/projects/website/document",
      headers: authHeaders(superCookie),
    });
    expect(document.statusCode).toBe(200);
    const documentBody = json(document);
    expectValid(
      schemaAt("/projects/{projectId}/document", "get", "200"),
      documentBody,
      "document",
    );

    const writeBody = {
      chapters: {
        ...documentBody.chapters,
        byId: {
          ...documentBody.chapters.byId,
          "password-reset": {
            ...documentBody.chapters.byId["password-reset"],
            commits: ["4f2a9c1"],
          },
        },
      },
      selectedId: documentBody.selectedId,
    };
    expectValid(
      apiDoc.components.schemas.DocumentWrite,
      writeBody,
      "document write request",
    );
    const saved = await api.app.inject({
      method: "PUT",
      url: "/api/v1/projects/website/document",
      headers: {
        ...authHeaders(superCookie),
        "content-type": "application/json",
        "if-match": document.headers.etag,
      },
      payload: writeBody,
    });
    expect(saved.statusCode).toBe(200);
    expectValid(
      schemaAt("/projects/{projectId}/document", "put", "200"),
      json(saved),
      "document write response",
    );

    const activity = await api.app.inject({
      method: "GET",
      url: "/api/v1/projects/website/activity",
      headers: authHeaders(superCookie),
    });
    expectValid(
      schemaAt("/projects/{projectId}/activity", "get", "200"),
      json(activity),
      "activity",
    );

    const coverage = await api.app.inject({
      method: "GET",
      url: "/api/v1/projects/website/coverage",
      headers: authHeaders(superCookie),
    });
    expectValid(
      schemaAt("/projects/{projectId}/coverage", "get", "200"),
      json(coverage),
      "coverage",
    );
  });

  it("matches activity and import responses with a browser session", async () => {
    const activity = await api.app.inject({
      method: "POST",
      url: "/api/v1/projects/website/activity",
      payload: {
        message: "Contract activity",
        chapterId: null,
        chapterName: "Website project",
      },
      headers: {
        ...authHeaders(superCookie),
        "content-type": "application/json",
      },
    });
    expect(activity.statusCode).toBe(201);
    expectValid(
      schemaAt("/projects/{projectId}/activity", "post", "201"),
      json(activity),
      "activity append",
    );

    const exported = await api.app.inject({
      method: "GET",
      url: "/api/v1/projects/website/export",
      headers: authHeaders(superCookie),
    });
    expect(exported.statusCode).toBe(200);
    const imported = await api.app.inject({
      method: "POST",
      url: "/api/v1/projects/import",
      headers: {
        ...authHeaders(superCookie),
        "content-type": "application/json",
      },
      payload: exported.payload,
    });
    expect(imported.statusCode).toBe(201);
    expectValid(
      schemaAt("/projects/import", "post", "201"),
      json(imported),
      "import",
    );
  });

  it("matches authentication and authorization error responses", async () => {
    const unauthorized = await api.app.inject({
      method: "GET",
      url: "/api/v1/projects",
    });
    expect(unauthorized.statusCode).toBe(401);
    expectValid(
      schemaAt("/projects", "get", "401"),
      json(unauthorized),
      "unauthenticated",
    );

    const member = await api.createMember(superCookie, {
      email: `contract-member-${Date.now()}@example.test`,
    });
    const forbidden = await api.app.inject({
      method: "GET",
      url: "/api/v1/users",
      headers: authHeaders(member.cookie),
    });
    expect(forbidden.statusCode).toBe(403);
    expectValid(schemaAt("/users", "get", "403"), json(forbidden), "forbidden");

    const notFound = await api.app.inject({
      method: "GET",
      url: "/api/v1/projects/missing",
      headers: authHeaders(superCookie),
    });
    expect(notFound.statusCode).toBe(404);
    expectValid(
      schemaAt("/projects/{projectId}", "get", "404"),
      json(notFound),
      "not found",
    );

    const conflict = await api.app.inject({
      method: "PUT",
      url: "/api/v1/projects/website/document",
      headers: {
        ...authHeaders(superCookie),
        "content-type": "application/json",
        "if-match": '"999"',
      },
      payload: { chapters: { byId: {}, rootIds: [] }, selectedId: null },
    });
    expect(conflict.statusCode).toBe(412);
    expectValid(
      schemaAt("/projects/{projectId}/document", "put", "412"),
      json(conflict),
      "revision conflict",
    );
  });

  it("documents only the super-admin password change, not recovery", () => {
    const paths = Object.keys(apiDoc.paths).join(" ");
    expect(paths).toContain("/me/password");
    expect(paths).not.toContain("forgot");
    expect(paths).not.toContain("reset-password");
    expect(paths).not.toContain("recover");
  });
});
