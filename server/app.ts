import fs from "node:fs";
import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import fastifyStatic from "@fastify/static";
import scalar from "@scalar/fastify-api-reference";
import Fastify, { type FastifyInstance } from "fastify";
import { parse as parseYaml } from "yaml";
import { ApiError, errorHandler, notFoundHandler } from "./api/errors";
import { registerActivityRoutes } from "./api/routes/activity";
import { registerAttachmentRoutes } from "./api/routes/attachments";
import { registerAuthRoutes } from "./api/routes/auth";
import { registerCoverageRoutes } from "./api/routes/coverage";
import { registerDocumentRoutes } from "./api/routes/document";
import { registerExportRoutes } from "./api/routes/exports";
import { registerHealthRoutes } from "./api/routes/health";
import { registerOAuthGrantRoutes } from "./api/routes/oauthGrants";
import { registerProjectRoutes } from "./api/routes/projects";
import { registerProjectTokenRoutes } from "./api/routes/projectTokens";
import { registerSearchRoutes } from "./api/routes/search";
import { registerTestRoutes } from "./api/routes/test";
import { registerUserRoutes } from "./api/routes/users";
import type { ServerConfig } from "./config";
import type { AuthStore } from "./db/authStore";
import type { OAuthStore } from "./db/oauthStore";
import type { ProjectStore } from "./db/store";
import type { PasswordHasher } from "./auth/password";
import { createAuthHooks } from "./auth/middleware";
import { registerMcpRoutes } from "./mcp/routes";
import { registerOAuthRoutes } from "./oauth/routes";

export interface BuildAppOptions {
  config: ServerConfig;
  store: ProjectStore;
  authStore: AuthStore;
  oauthStore: OAuthStore;
  passwordHasher: PasswordHasher;
  logger?: boolean;
  now?: () => string;
}

function readOpenApi(path: string): string {
  return fs.readFileSync(path, "utf8");
}

export async function buildApp({
  config,
  store,
  authStore,
  oauthStore,
  passwordHasher,
  logger = true,
  now,
}: BuildAppOptions): Promise<FastifyInstance> {
  const app = Fastify({
    logger: logger
      ? {
          redact: [
            "req.headers.authorization",
            "req.headers.cookie",
            "res.headers.set-cookie",
            'res.headers["set-cookie"]',
          ],
          serializers: {
            req: (request: {
              id?: string;
              method?: string;
              url?: string;
              hostname?: string;
              ip?: string;
              socket?: { remotePort?: number };
            }) => ({
              reqId: request.id,
              method: request.method,
              url: (request.url ?? "").split("?")[0],
              hostname: request.hostname,
              remoteAddress: request.ip,
              remotePort: request.socket?.remotePort,
            }),
          },
        }
      : false,
    bodyLimit: 10 * 1024 * 1024,
  });

  await app.register(cookie);
  await app.register(cors, {
    origin: config.uiOrigins,
    credentials: true,
    methods: ["GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Authorization", "Content-Type", "If-Match"],
    exposedHeaders: ["ETag", "Content-Disposition"],
  });
  await app.register(rateLimit, {
    global: false,
    errorResponseBuilder: (_request, context) =>
      new ApiError(429, "rate_limited", "Too many requests. Try again later.", {
        retryAfterSeconds: Math.max(1, Math.ceil(context.ttl / 1000)),
      }),
  });

  app.setErrorHandler((error, request, reply) => {
    if (
      config.oauth &&
      error instanceof ApiError &&
      error.status === 401 &&
      (request.raw.url ?? "").split("?")[0] === "/mcp"
    ) {
      reply.header(
        "WWW-Authenticate",
        `Bearer resource_metadata="${config.oauth.resourceMetadataUrl}", scope="read write"`,
      );
    }
    return errorHandler(error as Error, request, reply);
  });
  app.addHook("onSend", async (_request, reply, payload) => {
    if (String(reply.getHeader("content-type") ?? "").startsWith("text/html")) {
      reply.header("X-Frame-Options", "DENY");
    }
    return payload;
  });
  app.setNotFoundHandler((request, reply) => {
    const url = request.raw.url ?? "";
    const wantsHtml =
      request.method === "GET" &&
      !url.startsWith("/api/") &&
      !url.startsWith("/assets/") &&
      !url.startsWith("/oauth/") &&
      !url.startsWith("/.well-known/") &&
      fs.existsSync(config.staticRoot);
    if (wantsHtml) {
      return reply
        .type("text/html")
        .send(fs.readFileSync(`${config.staticRoot}/index.html`, "utf8"));
    }
    return notFoundHandler(request, reply);
  });

  const hooks = createAuthHooks({ config, authStore, oauthStore, now });
  const openapiYaml = readOpenApi(config.openapiPath);
  const openapi = parseYaml(openapiYaml) as Record<string, unknown>;

  app.get("/api/v1/openapi.json", async (_request, reply) => {
    reply.type("application/json");
    return openapi;
  });

  await app.register(scalar, {
    routePrefix: "/api/v1/docs",
    configuration: {
      content: openapiYaml,
      theme: "kepler",
    },
  });

  registerHealthRoutes(app, store);
  registerAuthRoutes(app, { config, authStore, hooks, passwordHasher });
  registerProjectTokenRoutes(app, store, authStore, hooks, now);
  registerOAuthGrantRoutes(app, store, oauthStore, hooks, now);
  registerUserRoutes(app, authStore, hooks, passwordHasher);
  registerProjectRoutes(app, store, hooks);
  registerDocumentRoutes(app, store, hooks);
  registerAttachmentRoutes(app, store, hooks);
  registerActivityRoutes(app, store, hooks);
  registerCoverageRoutes(app, store, hooks);
  registerSearchRoutes(app, store, hooks);
  registerExportRoutes(app, store, hooks);
  registerOAuthRoutes(app, {
    config,
    store,
    authStore,
    oauthStore,
    hooks,
    now,
  });
  registerMcpRoutes(app, store, hooks, config);
  if (config.testMode) {
    registerTestRoutes(app, {
      config,
      store,
      authStore,
      oauthStore,
      passwordHasher,
    });
  }

  if (fs.existsSync(config.staticRoot)) {
    await app.register(fastifyStatic, {
      root: config.staticRoot,
      prefix: "/",
      wildcard: false,
    });
  }

  app.addHook("onClose", async () => {
    store.close();
  });

  return app;
}
