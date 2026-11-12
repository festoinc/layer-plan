import type { FastifyInstance } from "fastify";
import type { ProjectStore } from "../../db/store";

export function registerTestRoutes(
  app: FastifyInstance,
  store: ProjectStore,
  seedSamples: boolean,
) {
  app.post("/api/v1/test/reset", async (_request, reply) => {
    store.reset(seedSamples);
    return reply.code(204).send();
  });
}
