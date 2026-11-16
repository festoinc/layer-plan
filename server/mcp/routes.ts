import fs from "node:fs";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { AuthHooks } from "../auth/middleware";
import type { ServerConfig } from "../config";
import { ApiError } from "../api/errors";
import {
  createProjectSchema,
  updateProjectSchema,
  putDocumentSchema,
  appendActivitySchema,
} from "../api/schemas";

const MAX_BYTES = 2 * 1024 * 1024;
const projectId = z.string().min(1).max(128);
const ifMatch = z.string().min(1);
const instructions = fs.readFileSync("server/mcp/instructions.md", "utf8");

type Operation = {
  name: string;
  description: string;
  method: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
  path: (args: Record<string, unknown>) => string;
  schema: z.ZodRawShape;
  readOnly?: boolean;
  destructive?: boolean;
};
const projectPath = (args: Record<string, unknown>) =>
  `/api/v1/projects/${encodeURIComponent(String(args.projectId))}`;
const operations: Operation[] = [
  {
    name: "list_projects",
    description: "List your projects and active project.",
    method: "GET",
    path: () => "/api/v1/projects",
    schema: {},
    readOnly: true,
  },
  {
    name: "create_project",
    description: "Create a project.",
    method: "POST",
    path: () => "/api/v1/projects",
    schema: { body: createProjectSchema },
  },
  {
    name: "get_project",
    description: "Get project metadata, guidelines, and its metadata ETag.",
    method: "GET",
    path: projectPath,
    schema: { projectId },
    readOnly: true,
  },
  {
    name: "update_project",
    description: "Update project metadata using its current ETag.",
    method: "PATCH",
    path: projectPath,
    schema: { projectId, ifMatch, body: updateProjectSchema },
  },
  {
    name: "delete_project",
    description:
      "Delete a project after explicit user confirmation, using its current metadata ETag.",
    method: "DELETE",
    path: projectPath,
    schema: { projectId, ifMatch },
    destructive: true,
  },
  {
    name: "duplicate_project",
    description: "Duplicate a project.",
    method: "POST",
    path: (a) => `${projectPath(a)}/duplicate`,
    schema: { projectId },
  },
  {
    name: "activate_project",
    description: "Set your active project.",
    method: "POST",
    path: (a) => `${projectPath(a)}/activate`,
    schema: { projectId },
  },
  {
    name: "get_document",
    description: "Read the full chapter tree and document ETag.",
    method: "GET",
    path: (a) => `${projectPath(a)}/document`,
    schema: { projectId },
    readOnly: true,
  },
  {
    name: "replace_document",
    description:
      "Replace a complete document using its current ETag. Ask before removing content.",
    method: "PUT",
    path: (a) => `${projectPath(a)}/document`,
    schema: { projectId, ifMatch, body: putDocumentSchema },
    destructive: true,
  },
  {
    name: "list_activity",
    description: "Read project activity.",
    method: "GET",
    path: (a) => {
      const query = new URLSearchParams();
      if (a.limit !== undefined) query.set("limit", String(a.limit));
      if (a.before !== undefined) query.set("before", String(a.before));
      const q = query.toString();
      return `${projectPath(a)}/activity${q ? `?${q}` : ""}`;
    },
    schema: {
      projectId,
      limit: z.number().int().min(1).max(100).optional(),
      before: z.number().int().min(1).optional(),
    },
    readOnly: true,
  },
  {
    name: "append_activity",
    description: "Append a project activity entry.",
    method: "POST",
    path: (a) => `${projectPath(a)}/activity`,
    schema: { projectId, body: appendActivitySchema },
  },
  {
    name: "get_coverage",
    description: "Read declaration-based verification coverage.",
    method: "GET",
    path: (a) => `${projectPath(a)}/coverage`,
    schema: { projectId },
    readOnly: true,
  },
  {
    name: "export_project",
    description: "Return a project export as JSON.",
    method: "GET",
    path: (a) => `${projectPath(a)}/export`,
    schema: { projectId },
    readOnly: true,
  },
  {
    name: "import_project",
    description: "Import JSON as a new project.",
    method: "POST",
    path: () => "/api/v1/projects/import",
    schema: { body: z.record(z.string(), z.unknown()) },
  },
];

export function registerMcpRoutes(
  app: FastifyInstance,
  hooks: AuthHooks,
  config: ServerConfig,
): void {
  app.route({
    method: ["POST", "GET", "DELETE"],
    url: "/mcp",
    bodyLimit: MAX_BYTES,
    preHandler: [
      async (request) => {
        const rawHost = request.headers.host ?? "";
        let hostname: string;
        try {
          if (!/^(?:\[[0-9a-f:.]+\]|[a-z0-9.-]+)(?::\d+)?$/i.test(rawHost)) {
            throw new Error("Invalid host header");
          }
          hostname = new URL(`http://${rawHost}`).hostname.toLowerCase();
        } catch {
          throw new ApiError(403, "invalid_host", "Invalid MCP host.");
        }
        if (!config.mcpAllowedHosts.includes(hostname))
          throw new ApiError(403, "invalid_host", "MCP host is not allowed.");
        const origin = request.headers.origin;
        if (origin && !config.uiOrigins.includes(origin))
          throw new ApiError(
            403,
            "invalid_origin",
            "MCP origin is not allowed.",
          );
      },
      hooks.requireMcpToken,
    ],
    handler: async (request, reply) => {
      const auth = request.headers.authorization!;
      const server = new McpServer(
        { name: "layers", version: "1.0.0" },
        { instructions },
      );
      for (const operation of operations) {
        server.registerTool(
          operation.name,
          {
            description: operation.description,
            inputSchema: operation.schema,
            annotations: {
              readOnlyHint: operation.readOnly ?? false,
              destructiveHint: operation.destructive ?? false,
            },
          },
          async (args) => {
            const input = args as Record<string, unknown>;
            const headers: Record<string, string> = { authorization: auth };
            if (typeof input.ifMatch === "string")
              headers["if-match"] = input.ifMatch;
            if (input.body !== undefined)
              headers["content-type"] = "application/json";
            const result = await app.inject({
              method: operation.method,
              url: operation.path(input),
              headers,
              ...(input.body !== undefined
                ? { payload: JSON.stringify(input.body) }
                : {}),
            });
            const envelope = {
              status: result.statusCode,
              body: JSON.parse(result.payload) as unknown,
              etag: result.headers.etag ?? null,
            };
            const text = JSON.stringify(envelope);
            if (Buffer.byteLength(text) > MAX_BYTES)
              return {
                isError: true,
                content: [
                  {
                    type: "text" as const,
                    text: "MCP response exceeds the 2 MiB limit.",
                  },
                ],
              };
            return {
              isError: result.statusCode >= 400,
              content: [{ type: "text" as const, text }],
            };
          },
        );
      }
      const transport = new WebStandardStreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
        enableJsonResponse: true,
      });
      await server.connect(transport);
      try {
        const headers = new Headers();
        for (const [key, value] of Object.entries(request.headers))
          if (value !== undefined)
            headers.set(
              key,
              Array.isArray(value) ? value.join(", ") : String(value),
            );
        const webRequest = new Request(`http://localhost/mcp`, {
          method: request.method,
          headers,
          ...(request.method === "POST"
            ? { body: JSON.stringify(request.body) }
            : {}),
        });
        const response = await transport.handleRequest(webRequest, {
          parsedBody: request.body,
        });
        const result = await response.text();
        if (Buffer.byteLength(result) > MAX_BYTES)
          return reply.code(413).send({
            error: {
              code: "payload_too_large",
              message: "MCP response exceeds the 2 MiB limit.",
            },
          });
        reply.code(response.status);
        response.headers.forEach((value, key) => {
          if (key !== "content-length") reply.header(key, value);
        });
        return reply.send(result);
      } finally {
        await server.close();
      }
    },
  });
}
