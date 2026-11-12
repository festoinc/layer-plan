import type { FastifyInstance } from "fastify";
import type { ProjectStore } from "../../db/store";

export function registerHealthRoutes(
  app: FastifyInstance,
  store: ProjectStore,
) {
  app.get("/api/v1/health", async (_request, reply) => {
    try {
      store.listProjects();
      return {
        status: "ok",
        version: "1.0.0",
        database: "ok",
      };
    } catch {
      return reply.code(503).send({
        error: {
          code: "database_unavailable",
          message: "The SQLite database is unavailable.",
        },
      });
    }
  });
}
