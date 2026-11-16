import type { FastifyInstance } from "fastify";
import { createId } from "../../../src/domain/schema";
import {
  activityQuerySchema,
  appendActivitySchema,
  parseBody,
  parseQuery,
} from "../schemas";
import type { ProjectStore } from "../../db/store";
import type { AuthHooks } from "../../auth/middleware";

interface ProjectParams {
  id: string;
}

export function registerActivityRoutes(
  app: FastifyInstance,
  store: ProjectStore,
  hooks: AuthHooks,
) {
  app.get<{ Params: ProjectParams }>(
    "/api/v1/projects/:id/activity",
    { preHandler: hooks.requireAuth },
    async (request) => {
      const query = parseQuery(activityQuerySchema, request.query);
      const events = store.listActivity(
        request.auth!.user.id,
        request.params.id,
        query,
      );
      return { events, nextBefore: null };
    },
  );

  app.post<{ Params: ProjectParams }>(
    "/api/v1/projects/:id/activity",
    { preHandler: hooks.requireAuth },
    async (request, reply) => {
      const input = parseBody(appendActivitySchema, request.body);
      const events = store.appendActivity(
        request.auth!.user.id,
        request.params.id,
        {
          ...input,
          id: createId(),
        },
      );
      return reply.code(201).send({ events });
    },
  );
}
