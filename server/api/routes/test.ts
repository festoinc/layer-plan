import type { FastifyInstance } from "fastify";
import type { ServerConfig } from "../../config";
import type { AuthStore } from "../../db/authStore";
import type { ProjectStore } from "../../db/store";
import type { PasswordHasher } from "../../auth/password";
import { bootstrap, resetAllData } from "../../db/bootstrap";

export interface TestRouteOptions {
  config: ServerConfig;
  store: ProjectStore;
  authStore: AuthStore;
  passwordHasher: PasswordHasher;
}

export function registerTestRoutes(
  app: FastifyInstance,
  { config, store, authStore, passwordHasher }: TestRouteOptions,
) {
  app.post("/api/v1/test/reset", async (_request, reply) => {
    resetAllData(store, authStore);
    await bootstrap({ config, store, authStore, passwordHasher });
    return reply.code(204).send();
  });
}
