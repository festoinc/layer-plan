import type { FastifyInstance } from "fastify";
import { formatEtag, parseIfMatch } from "../etag";
import {
  parseBody,
  createProjectSchema,
  updateProjectSchema,
} from "../schemas";
import type { ProjectStore } from "../../db/store";

interface ProjectParams {
  id: string;
}

export function registerProjectRoutes(
  app: FastifyInstance,
  store: ProjectStore,
) {
  app.get("/api/v1/projects", async () => store.listProjects());

  app.post("/api/v1/projects", async (request, reply) => {
    const input = parseBody(createProjectSchema, request.body);
    const project = store.createProject(input);
    reply.header("ETag", formatEtag(project.metadataRevision));
    return reply.code(201).send(project);
  });

  app.get<{ Params: ProjectParams }>(
    "/api/v1/projects/:id",
    async (request, reply) => {
      const project = store.getProject(request.params.id);
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
    async (request, reply) => {
      const revision = parseIfMatch(request.headers["if-match"]);
      const patch = parseBody(updateProjectSchema, request.body);
      const project = store.updateProject(request.params.id, patch, revision);
      reply.header("ETag", formatEtag(project.metadataRevision));
      return project;
    },
  );

  app.delete<{ Params: ProjectParams }>(
    "/api/v1/projects/:id",
    async (request) => {
      const revision = parseIfMatch(request.headers["if-match"]);
      const result = store.deleteProject(request.params.id, revision);
      return result;
    },
  );

  app.post<{ Params: ProjectParams }>(
    "/api/v1/projects/:id/duplicate",
    async (request, reply) => {
      const project = store.duplicateProject(request.params.id);
      reply.header("ETag", formatEtag(project.metadataRevision));
      return reply.code(201).send(project);
    },
  );

  app.post<{ Params: ProjectParams }>(
    "/api/v1/projects/:id/activate",
    async (request) => ({
      activeProjectId: store.activateProject(request.params.id),
    }),
  );
}
