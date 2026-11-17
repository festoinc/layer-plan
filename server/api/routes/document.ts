import type { FastifyInstance } from "fastify";
import { formatEtag, parseIfMatch } from "../etag";
import { parseBody, putDocumentSchema } from "../schemas";
import type { ProjectStore } from "../../db/store";
import type { AuthHooks } from "../../auth/middleware";
import { ApiError } from "../errors";

interface ProjectParams {
  id: string;
}

export function registerDocumentRoutes(
  app: FastifyInstance,
  store: ProjectStore,
  hooks: AuthHooks,
) {
  app.get<{ Params: ProjectParams }>(
    "/api/v1/projects/:id/document",
    { preHandler: hooks.requireAuth },
    async (request, reply) => {
      const document = store.getDocument(
        request.auth!.user.id,
        request.params.id,
      );
      if (!document) {
        return reply.code(404).send({
          error: {
            code: "not_found",
            message: "The project document does not exist.",
          },
        });
      }
      reply.header("ETag", formatEtag(document.revision));
      return document;
    },
  );

  app.put<{ Params: ProjectParams }>(
    "/api/v1/projects/:id/document",
    { preHandler: hooks.requireAuth },
    async (request, reply) => {
      if (!store.getProject(request.auth!.user.id, request.params.id)) {
        throw new ApiError(404, "not_found", "The project does not exist.");
      }
      const revision = parseIfMatch(request.headers["if-match"]);
      const input = parseBody(putDocumentSchema, request.body);
      const result = store.saveDocument(
        request.auth!.user.id,
        request.params.id,
        input,
        revision,
      );
      reply.header("ETag", formatEtag(result.document.revision));
      return {
        ...result.document,
        stats: result.stats,
        activity: result.activity,
        createdSubchapters: result.createdSubchapters,
      };
    },
  );
}
