import type { FastifyInstance } from "fastify";
import type { AuthHooks } from "../../auth/middleware";
import type { ProjectStore } from "../../db/store";
import {
  SEARCH_DEFAULT_LIMIT,
  searchChapters,
} from "../../../src/domain/search";
import { ApiError } from "../errors";
import { parseQuery, searchQuerySchema } from "../schemas";

interface ProjectParams {
  id: string;
}

const SEARCH_RATE_LIMIT = 120;
const SEARCH_RATE_WINDOW_MS = 60_000;

export function registerSearchRoutes(
  app: FastifyInstance,
  store: ProjectStore,
  hooks: AuthHooks,
) {
  app.get<{ Params: ProjectParams }>(
    "/api/v1/projects/:id/search",
    {
      preHandler: hooks.requireAuth,
      config: {
        rateLimit: {
          max: SEARCH_RATE_LIMIT,
          timeWindow: SEARCH_RATE_WINDOW_MS,
          hook: "preHandler",
          keyGenerator: (request) => request.auth?.user.id ?? request.ip,
        },
      },
    },
    async (request, reply) => {
      const input = parseQuery(searchQuerySchema, request.query);
      const document = store.getDocument(
        request.auth!.user.id,
        request.params.id,
      );
      if (!document) {
        throw new ApiError(404, "not_found", "The project does not exist.");
      }

      const result = searchChapters(document.chapters, input.q, {
        limit: input.limit,
        offset: input.offset,
      });
      reply.header("Cache-Control", "no-store");
      return {
        projectId: document.projectId,
        query: result.query,
        documentRevision: document.revision,
        total: result.total,
        offset: input.offset ?? 0,
        limit: input.limit ?? SEARCH_DEFAULT_LIMIT,
        truncated: result.truncated,
        results: result.results,
      };
    },
  );
}
