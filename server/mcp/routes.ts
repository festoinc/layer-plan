import fs from "node:fs";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { AuthHooks } from "../auth/middleware";
import type { ServerConfig } from "../config";
import { ApiError } from "../api/errors";
import { MCP_BODY_LIMIT } from "../api/attachmentLimits";
import {
  updateProjectSchema,
  putDocumentSchema,
  uploadAttachmentSchema,
} from "../api/schemas";
import {
  ATTACHMENT_EXTENSIONS,
  MAX_ATTACHMENT_BYTES,
} from "../../src/domain/attachments";
import { MAX_CHAPTER_TITLE } from "../../src/domain/chapters";
import { formatEtag } from "../api/etag";
import type { ProjectStore } from "../db/store";
import {
  SEARCH_MAX_LIMIT,
  SEARCH_MAX_QUERY_LENGTH,
  SEARCH_MIN_QUERY_LENGTH,
} from "../../src/domain/search";

const MAX_BYTES = 2 * 1024 * 1024;
const projectId = z.string().min(1).max(128);
const ifMatch = z.string().min(1);
const attachmentId = z.string().min(1).max(128);
const instructions = fs.readFileSync("server/mcp/instructions.md", "utf8");

interface McpEnvelope {
  status: number;
  body: unknown;
  etag: string | null;
}

interface McpAuth {
  userId: string;
  projectId: string;
}

type Operation = {
  name: string;
  description: string;
  method: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
  path: (args: Record<string, unknown>) => string;
  schema: z.ZodRawShape;
  projectScoped?: boolean;
  readOnly?: boolean;
  destructive?: boolean;
  /** Build a JSON request body from flat tool arguments. */
  payload?: (args: Record<string, unknown>) => unknown;
  /** Read the store in process instead of dispatching a REST request. */
  run?: (
    args: Record<string, unknown>,
    auth: McpAuth,
  ) => Promise<McpEnvelope> | McpEnvelope;
  /** Let a run result exceed the regular tool envelope limit. */
  allowLargeResult?: boolean;
};
const projectPath = (args: Record<string, unknown>) =>
  `/api/v1/projects/${encodeURIComponent(String(args.projectId))}`;
function createOperations(store: ProjectStore): Operation[] {
  return [
    {
      name: "list_projects",
      description:
        "List projects available to this API key. A project key returns exactly one project.",
      method: "GET",
      path: () => "/api/v1/projects",
      schema: {},
      readOnly: true,
    },
    {
      name: "get_project",
      description:
        "Get the bound project's metadata, guidelines, and metadata ETag.",
      method: "GET",
      path: projectPath,
      schema: { projectId },
      projectScoped: true,
      readOnly: true,
    },
    {
      name: "update_project",
      description: "Update the bound project metadata using its current ETag.",
      method: "PATCH",
      path: projectPath,
      schema: { projectId, ifMatch, body: updateProjectSchema },
      projectScoped: true,
    },
    {
      name: "get_document",
      description:
        "Read the bound project's full chapter tree and document ETag.",
      method: "GET",
      path: (a) => `${projectPath(a)}/document`,
      schema: { projectId },
      projectScoped: true,
      readOnly: true,
    },
    {
      name: "replace_document",
      description:
        "Replace the bound project's complete document using its current ETag. The backend creates subchapters for new non-final criteria and keeps every criterion/subchapter pair synchronized; deleting either side deletes the other. Ask before removing content.",
      method: "PUT",
      path: (a) => `${projectPath(a)}/document`,
      schema: { projectId, ifMatch, body: putDocumentSchema },
      projectScoped: true,
      destructive: true,
    },
    {
      name: "list_activity",
      description: "Read the bound project's activity.",
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
      projectScoped: true,
      readOnly: true,
    },
    {
      name: "create_root_chapter",
      description:
        "Create one top-level chapter (parentId null) in the bound project, append it to the root order, select it and log it in activity. Returns the updated document and the new chapter. Use replace_document when the new chapter must sit under a parent.",
      method: "POST",
      path: (a) => `${projectPath(a)}/document`,
      schema: {
        projectId,
        title: z.string().trim().min(1).max(MAX_CHAPTER_TITLE),
        description: z.string().max(100000).optional(),
        finalLevel: z.boolean().optional(),
      },
      projectScoped: true,
      run: (args, auth) => {
        const result = store.createRootChapter(auth.userId, auth.projectId, {
          title: String(args.title),
          description:
            typeof args.description === "string" ? args.description : undefined,
          finalLevel: args.finalLevel === true,
        });
        return {
          status: 201,
          body: {
            ...result.document,
            createdChapter: result.chapter,
            stats: result.stats,
            activity: result.activity,
          },
          etag: formatEtag(result.document.revision),
        };
      },
    },
    {
      name: "get_coverage",
      description:
        "Read the bound project's declaration-based verification coverage.",
      method: "GET",
      path: (a) => `${projectPath(a)}/coverage`,
      schema: { projectId },
      projectScoped: true,
      readOnly: true,
    },
    {
      name: "search_project",
      description:
        "Search the bound project's chapter titles, descriptions, criteria, commit hashes and verification text. Searches one project only; activity and project metadata are not searched.",
      method: "GET",
      path: (a) => {
        const query = new URLSearchParams({ q: String(a.q) });
        if (a.limit !== undefined) query.set("limit", String(a.limit));
        if (a.offset !== undefined) query.set("offset", String(a.offset));
        return `${projectPath(a)}/search?${query.toString()}`;
      },
      schema: {
        projectId,
        q: z
          .string()
          .trim()
          .min(SEARCH_MIN_QUERY_LENGTH)
          .max(SEARCH_MAX_QUERY_LENGTH),
        limit: z.number().int().min(1).max(SEARCH_MAX_LIMIT).optional(),
        offset: z.number().int().min(0).optional(),
      },
      projectScoped: true,
      readOnly: true,
    },
    {
      name: "list_attachments",
      description: `List the bound project document's attachments. The project can have at most 20 attachments. Allowed types: ${ATTACHMENT_EXTENSIONS.join(", ")}.`,
      method: "GET",
      path: (a) => `${projectPath(a)}/attachments`,
      schema: { projectId },
      projectScoped: true,
      readOnly: true,
    },
    {
      name: "get_attachment",
      description:
        "Read one attachment's metadata and base64 content. Use list_attachments first to get the attachment id.",
      method: "GET",
      path: (a) =>
        `${projectPath(a)}/attachments/${encodeURIComponent(String(a.attachmentId))}/content`,
      schema: { projectId, attachmentId },
      projectScoped: true,
      readOnly: true,
      allowLargeResult: true,
      run: (args, auth) => {
        const attachment = store.getAttachment(
          auth.userId,
          auth.projectId,
          String(args.attachmentId),
        );
        if (!attachment) {
          return {
            status: 404,
            body: {
              error: {
                code: "attachment_not_found",
                message: "The attachment does not exist.",
              },
            },
            etag: null,
          };
        }
        const { content, ...info } = attachment;
        return {
          status: 200,
          body: { ...info, contentBase64: content.toString("base64") },
          etag: null,
        };
      },
    },
    {
      name: "add_attachment",
      description: `Attach a supported file to the bound project document. contentBase64 is the raw base64 file content, at most ${MAX_ATTACHMENT_BYTES} decoded bytes. At most 20 attachments are allowed. Allowed types: ${ATTACHMENT_EXTENSIONS.join(", ")}.`,
      method: "POST",
      path: (a) => `${projectPath(a)}/attachments`,
      schema: {
        projectId,
        filename: uploadAttachmentSchema.shape.filename,
        contentBase64: uploadAttachmentSchema.shape.contentBase64,
      },
      payload: (a) => ({
        filename: a.filename,
        contentBase64: a.contentBase64,
      }),
      projectScoped: true,
    },
    {
      name: "delete_attachment",
      description:
        "Delete one attachment from the bound project document after explicit user confirmation.",
      method: "DELETE",
      path: (a) =>
        `${projectPath(a)}/attachments/${encodeURIComponent(String(a.attachmentId))}`,
      schema: { projectId, attachmentId },
      projectScoped: true,
      destructive: true,
    },
  ];
}

function textResult(envelope: unknown, isError: boolean) {
  return {
    isError,
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(envelope),
      },
    ],
  };
}

function notFoundResult() {
  return textResult(
    {
      status: 404,
      body: {
        error: {
          code: "not_found",
          message: "The project does not exist.",
        },
      },
      etag: null,
    },
    true,
  );
}

export function registerMcpRoutes(
  app: FastifyInstance,
  store: ProjectStore,
  hooks: AuthHooks,
  config: ServerConfig,
): void {
  app.route({
    method: ["POST", "GET", "DELETE"],
    url: "/mcp",
    bodyLimit: MCP_BODY_LIMIT,
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
      const auth = request.auth;
      if (!auth || auth.method !== "token") {
        throw new ApiError(
          401,
          "unauthenticated",
          "A project API key is required.",
        );
      }
      const internalHeaders = {
        [hooks.internalAuth.headerName]: hooks.internalAuth.sign({
          userId: auth.user.id,
          projectId: auth.projectId,
          tokenId: auth.tokenId,
          scopes: auth.scopes,
        }),
      };
      const server = new McpServer(
        { name: "layers", version: "1.0.0" },
        { instructions },
      );
      server.registerTool(
        "how_to_work_with_this_mcp",
        {
          description:
            "Return this server's full working guide: the project model, the two planning modes, tool result envelopes, ETag and revision rules, and the document read/write contract. Call it first, before other tools, and follow it.",
          inputSchema: {},
          annotations: { readOnlyHint: true, destructiveHint: false },
        },
        async () => ({
          content: [{ type: "text" as const, text: instructions }],
        }),
      );
      for (const operation of createOperations(store)) {
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
            if (operation.projectScoped && input.projectId !== auth.projectId) {
              return notFoundResult();
            }
            // `run` tools bypass the REST scope check, so enforce it here.
            if (!operation.readOnly && !auth.scopes.includes("write")) {
              return textResult(
                {
                  status: 403,
                  body: {
                    error: {
                      code: "forbidden",
                      message: "The API key does not allow this operation.",
                      details: { requiredScope: "write" },
                    },
                  },
                  etag: null,
                },
                true,
              );
            }
            if (operation.run) {
              const envelope = await operation.run(input, {
                userId: auth.user.id,
                projectId: auth.projectId,
              });
              const text = JSON.stringify(envelope);
              if (
                !operation.allowLargeResult &&
                Buffer.byteLength(text) > MAX_BYTES
              ) {
                return textResult(
                  {
                    error: {
                      code: "payload_too_large",
                      message: "MCP response exceeds the allowed limit.",
                    },
                  },
                  true,
                );
              }
              return textResult(envelope, envelope.status >= 400);
            }
            const payload = operation.payload
              ? operation.payload(input)
              : input.body;
            const headers: Record<string, string> = { ...internalHeaders };
            if (typeof input.ifMatch === "string")
              headers["if-match"] = input.ifMatch;
            if (payload !== undefined)
              headers["content-type"] = "application/json";
            const result = await app.inject({
              method: operation.method,
              url: operation.path(input),
              headers,
              ...(payload !== undefined
                ? { payload: JSON.stringify(payload) }
                : {}),
            });
            const body = result.payload ? JSON.parse(result.payload) : null;
            const envelope = {
              status: result.statusCode,
              body,
              etag: result.headers.etag ?? null,
            };
            const text = JSON.stringify(envelope);
            if (Buffer.byteLength(text) > MAX_BYTES) {
              return textResult(
                {
                  error: {
                    code: "payload_too_large",
                    message: "MCP response exceeds the allowed limit.",
                  },
                },
                true,
              );
            }
            return textResult(envelope, result.statusCode >= 400);
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
        if (Buffer.byteLength(result) > MCP_BODY_LIMIT)
          return reply.code(413).send({
            error: {
              code: "payload_too_large",
              message: "MCP response exceeds the allowed limit.",
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
