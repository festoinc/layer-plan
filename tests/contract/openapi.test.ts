import path from "node:path";
import SwaggerParser from "@apidevtools/swagger-parser";
import Ajv, { type ValidateFunction } from "ajv";
import addFormats from "ajv-formats";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestApi, json, type TestApi } from "../api/helpers";

const specPath = path.resolve("server/api/openapi.yaml");
const ajv = new Ajv({ strict: false, allErrors: true });
addFormats(ajv);

let apiDoc: any;
let api: TestApi;

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
});

afterAll(async () => {
  await api?.close();
});

describe("OpenAPI contract", () => {
  it("documents every API route", () => {
    expect(Object.keys(apiDoc.paths).sort()).toEqual(
      [
        "/health",
        "/openapi.json",
        "/projects",
        "/projects/{projectId}",
        "/projects/{projectId}/activate",
        "/projects/{projectId}/activity",
        "/projects/{projectId}/coverage",
        "/projects/{projectId}/document",
        "/projects/{projectId}/duplicate",
        "/projects/{projectId}/export",
        "/projects/import",
      ].sort(),
    );
  });

  it("matches the catalog responses", async () => {
    const response = await api.app.inject({
      method: "GET",
      url: "/api/v1/projects",
    });
    expect(response.statusCode).toBe(200);
    expectValid(schemaAt("/projects", "get", "200"), json(response), "catalog");

    const detail = await api.app.inject({
      method: "GET",
      url: "/api/v1/projects/website",
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
    });
    expect(document.statusCode).toBe(200);
    const documentBody = json(document);
    expectValid(
      schemaAt("/projects/{projectId}/document", "get", "200"),
      documentBody,
      "document",
    );

    const writeBody = {
      chapters: documentBody.chapters,
      selectedId: documentBody.selectedId,
    };
    expectValid(
      schemaAt("/projects/{projectId}/document", "put", "200")
        ? apiDoc.components.schemas.DocumentWrite
        : {},
      writeBody,
      "document write request",
    );
    const saved = await api.app.inject({
      method: "PUT",
      url: "/api/v1/projects/website/document",
      headers: {
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
    });
    expectValid(
      schemaAt("/projects/{projectId}/activity", "get", "200"),
      json(activity),
      "activity",
    );

    const coverage = await api.app.inject({
      method: "GET",
      url: "/api/v1/projects/website/coverage",
    });
    expectValid(
      schemaAt("/projects/{projectId}/coverage", "get", "200"),
      json(coverage),
      "coverage",
    );
  });

  it("matches activity and import responses", async () => {
    const activity = await api.app.inject({
      method: "POST",
      url: "/api/v1/projects/website/activity",
      payload: {
        message: "Contract activity",
        chapterId: null,
        chapterName: "Website project",
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
    });
    expect(exported.statusCode).toBe(200);
    const imported = await api.app.inject({
      method: "POST",
      url: "/api/v1/projects/import",
      headers: { "content-type": "application/json" },
      payload: exported.payload,
    });
    expect(imported.statusCode).toBe(201);
    expectValid(
      schemaAt("/projects/import", "post", "201"),
      json(imported),
      "import",
    );
  });

  it("matches error responses", async () => {
    const notFound = await api.app.inject({
      method: "GET",
      url: "/api/v1/projects/missing",
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
});
