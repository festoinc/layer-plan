import type { FastifyInstance } from "fastify";
import type { ProjectStore } from "../../db/store";
import type { AuthHooks } from "../../auth/middleware";

interface ProjectParams {
  id: string;
}

function filename(name: string): string {
  const slug =
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 48) || "project";
  return `layers-${slug}-${new Date().toISOString().slice(0, 10)}.json`;
}

export function registerExportRoutes(
  app: FastifyInstance,
  store: ProjectStore,
  hooks: AuthHooks,
) {
  app.get<{ Params: ProjectParams }>(
    "/api/v1/projects/:id/export",
    { preHandler: hooks.requireAuth },
    async (request, reply) => {
      const project = store.getProject(
        request.auth!.user.id,
        request.params.id,
      );
      const exported = store.exportProject(
        request.auth!.user.id,
        request.params.id,
      );
      if (!project || !exported) {
        return reply.code(404).send({
          error: {
            code: "not_found",
            message: "The project does not exist.",
          },
        });
      }
      reply.header(
        "Content-Disposition",
        `attachment; filename="${filename(project.name)}"`,
      );
      reply.type("application/json");
      return JSON.stringify(exported, null, 2);
    },
  );

  app.post(
    "/api/v1/projects/import",
    { preHandler: hooks.requireAuth },
    async (request, reply) => {
      const result = store.importProject(request.auth!.user.id, request.body);
      return reply.code(201).send(result);
    },
  );
}
