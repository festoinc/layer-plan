import type { FastifyInstance } from "fastify";
import type { ProjectStore } from "../../db/store";

interface ProjectParams {
  id: string;
}

export function registerCoverageRoutes(
  app: FastifyInstance,
  store: ProjectStore,
) {
  app.get<{ Params: ProjectParams }>(
    "/api/v1/projects/:id/coverage",
    async (request) => store.getCoverage(request.params.id),
  );
}
