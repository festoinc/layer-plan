import type { FastifyInstance } from "fastify";
import { formatEtag, parseIfMatch } from "../etag";
import {
  parseBody,
  createProjectSchema,
  updateProjectSchema,
} from "../schemas";
import type { ProjectStore } from "../../db/store";
import type { AuthHooks } from "../../auth/middleware";
import { ApiError } from "../errors";

interface ProjectParams {
  id: string;
}

export function registerProjectRoutes(
  app: FastifyInstance,
  store: ProjectStore,
  hooks: AuthHooks,
) {
  app.get(
    "/api/v1/projects",
    { preHandler: hooks.requireAuth },
    async (request) => store.listProjects(request.auth!.user.id),
  );

  app.post(
    "/api/v1/projects",
    { preHandler: hooks.requireAuth },
    async (request, reply) => {
      const input = parseBody(createProjectSchema, request.body);
      const project = store.createProject(request.auth!.user.id, input);
      reply.header("ETag", formatEtag(project.metadataRevision));
      return reply.code(201).send(project);
    },
  );

  app.get<{ Params: ProjectParams }>(
    "/api/v1/projects/:id",
    { preHandler: hooks.requireAuth },
    async (request, reply) => {
      const project = store.getProject(
        request.auth!.user.id,
        request.params.id,
      );
      if (!project) {
        return reply.code(404).send({
          error: {
            code: "not_found",
            message: "The project does not exist.",
          },
        });
      }
      reply.header("ETag", formatEtag(project.metadataRevision));
      return project;
    },
  );

  app.patch<{ Params: ProjectParams }>(
    "/api/v1/projects/:id",
    { preHandler: hooks.requireAuth },
    async (request, reply) => {
      if (!store.getProject(request.auth!.user.id, request.params.id)) {
        throw new ApiError(404, "not_found", "The project does not exist.");
      }
      const revision = parseIfMatch(request.headers["if-match"]);
      const patch = parseBody(updateProjectSchema, request.body);
      const project = store.updateProject(
        request.auth!.user.id,
        request.params.id,
        patch,
        revision,
      );
      reply.header("ETag", formatEtag(project.metadataRevision));
      return project;
    },
  );

  app.delete<{ Params: ProjectParams }>(
    "/api/v1/projects/:id",
    { preHandler: hooks.requireAuth },
    async (request) => {
      if (!store.getProject(request.auth!.user.id, request.params.id)) {
        throw new ApiError(404, "not_found", "The project does not exist.");
      }
      const revision = parseIfMatch(request.headers["if-match"]);
      return store.deleteProject(
        request.auth!.user.id,
        request.params.id,
        revision,
      );
    },
  );

  app.post<{ Params: ProjectParams }>(
    "/api/v1/projects/:id/duplicate",
    { preHandler: hooks.requireAuth },
    async (request, reply) => {
      const project = store.duplicateProject(
        request.auth!.user.id,
        request.params.id,
      );
      reply.header("ETag", formatEtag(project.metadataRevision));
      return reply.code(201).send(project);
    },
  );

  app.post<{ Params: ProjectParams }>(
    "/api/v1/projects/:id/activate",
    { preHandler: hooks.requireAuth },
    async (request) => ({
      activeProjectId: store.activateProject(
        request.auth!.user.id,
        request.params.id,
      ),
    }),
  );
}
