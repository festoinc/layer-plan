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
import { registerAuthRoutes } from "./api/routes/auth";
import { registerCoverageRoutes } from "./api/routes/coverage";
import { registerDocumentRoutes } from "./api/routes/document";
import { registerExportRoutes } from "./api/routes/exports";
import { registerHealthRoutes } from "./api/routes/health";
import { registerMeRoutes } from "./api/routes/me";
import { registerProjectRoutes } from "./api/routes/projects";
import { registerTestRoutes } from "./api/routes/test";
import { registerUserRoutes } from "./api/routes/users";
import type { ServerConfig } from "./config";
import type { AuthStore } from "./db/authStore";
import type { ProjectStore } from "./db/store";
import type { PasswordHasher } from "./auth/password";
import { createAuthHooks } from "./auth/middleware";
import { registerMcpRoutes } from "./mcp/routes";

export interface BuildAppOptions {
  config: ServerConfig;
  store: ProjectStore;
  authStore: AuthStore;
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
      new ApiError(
        429,
        "rate_limited",
        "Too many sign-in attempts. Try again later.",
        { retryAfterSeconds: Math.max(1, Math.ceil(context.ttl / 1000)) },
      ),
  });

  app.setErrorHandler(errorHandler);
  app.setNotFoundHandler((request, reply) => {
    const url = request.raw.url ?? "";
    const wantsHtml =
      request.method === "GET" &&
      !url.startsWith("/api/") &&
      !url.startsWith("/assets/") &&
      fs.existsSync(config.staticRoot);
    if (wantsHtml) {
      return reply
        .type("text/html")
        .send(fs.readFileSync(`${config.staticRoot}/index.html`, "utf8"));
    }
    return notFoundHandler(request, reply);
  });

  const hooks = createAuthHooks({ config, authStore, now });
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
  registerMeRoutes(app, authStore, hooks);
  registerUserRoutes(app, authStore, hooks, passwordHasher);
  registerProjectRoutes(app, store, hooks);
  registerDocumentRoutes(app, store, hooks);
  registerActivityRoutes(app, store, hooks);
  registerCoverageRoutes(app, store, hooks);
  registerExportRoutes(app, store, hooks);
  registerMcpRoutes(app, hooks, config);
  if (config.testMode) {
    registerTestRoutes(app, { config, store, authStore, passwordHasher });
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
