import type { FastifyInstance } from "fastify";
import { formatEtag, parseIfMatch } from "../etag";
import { parseBody, putDocumentSchema } from "../schemas";
import type { ProjectStore } from "../../db/store";

interface ProjectParams {
  id: string;
}

export function registerDocumentRoutes(
  app: FastifyInstance,
  store: ProjectStore,
) {
  app.get<{ Params: ProjectParams }>(
    "/api/v1/projects/:id/document",
    async (request, reply) => {
      const document = store.getDocument(request.params.id);
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
    async (request, reply) => {
      const revision = parseIfMatch(request.headers["if-match"]);
      const input = parseBody(putDocumentSchema, request.body);
      const result = store.saveDocument(request.params.id, input, revision);
      reply.header("ETag", formatEtag(result.document.revision));
      return {
        ...result.document,
        stats: result.stats,
        activity: result.activity,
      };
    },
  );
}
