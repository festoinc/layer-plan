import fs from "node:fs";
import cors from "@fastify/cors";
import fastifyStatic from "@fastify/static";
import scalar from "@scalar/fastify-api-reference";
import Fastify, { type FastifyInstance } from "fastify";
import { parse as parseYaml } from "yaml";
import { errorHandler, notFoundHandler } from "./api/errors";
import { registerActivityRoutes } from "./api/routes/activity";
import { registerCoverageRoutes } from "./api/routes/coverage";
import { registerDocumentRoutes } from "./api/routes/document";
import { registerExportRoutes } from "./api/routes/exports";
import { registerHealthRoutes } from "./api/routes/health";
import { registerProjectRoutes } from "./api/routes/projects";
import { registerTestRoutes } from "./api/routes/test";
import type { ServerConfig } from "./config";
import type { ProjectStore } from "./db/store";

export interface BuildAppOptions {
  config: ServerConfig;
  store: ProjectStore;
  logger?: boolean;
}

function readOpenApi(path: string): string {
  return fs.readFileSync(path, "utf8");
}

export async function buildApp({
  config,
  store,
  logger = true,
}: BuildAppOptions): Promise<FastifyInstance> {
  const app = Fastify({
    logger,
    bodyLimit: 10 * 1024 * 1024,
  });

  await app.register(cors, {
    origin: [/^http:\/\/127\.0\.0\.1:\d+$/, /^http:\/\/localhost:\d+$/],
    methods: ["GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "If-Match"],
    exposedHeaders: ["ETag", "Content-Disposition"],
  });

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
  registerProjectRoutes(app, store);
  registerDocumentRoutes(app, store);
  registerActivityRoutes(app, store);
  registerCoverageRoutes(app, store);
  registerExportRoutes(app, store);
  if (config.testMode) {
    registerTestRoutes(app, store, config.seedSamples);
  }

  if (fs.existsSync(config.staticRoot)) {
    await app.register(fastifyStatic, {
      root: config.staticRoot,
      prefix: "/",
      wildcard: false,
    });
  }

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

  app.addHook("onClose", async () => {
    store.close();
  });

  return app;
}
