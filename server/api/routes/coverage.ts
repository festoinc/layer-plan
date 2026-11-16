import type { FastifyInstance } from "fastify";
import type { ProjectStore } from "../../db/store";
import type { AuthHooks } from "../../auth/middleware";

interface ProjectParams {
  id: string;
}

export function registerCoverageRoutes(
  app: FastifyInstance,
  store: ProjectStore,
  hooks: AuthHooks,
) {
  app.get<{ Params: ProjectParams }>(
    "/api/v1/projects/:id/coverage",
    { preHandler: hooks.requireAuth },
    async (request) =>
      store.getCoverage(request.auth!.user.id, request.params.id),
  );
}
