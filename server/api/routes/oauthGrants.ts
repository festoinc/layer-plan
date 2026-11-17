import type { FastifyInstance, FastifyRequest } from "fastify";
import type { OAuthStore } from "../../db/oauthStore";
import type { ProjectStore } from "../../db/store";
import type { AuthHooks } from "../../auth/middleware";
import type { AuthContext } from "../../auth/types";
import { ApiError } from "../errors";
import { oauthGrantJson } from "../serializers";

interface ProjectParams {
  id: string;
}

interface GrantParams extends ProjectParams {
  grantId: string;
}

function sessionAuth(
  request: FastifyRequest,
): Extract<AuthContext, { method: "session" }> {
  if (request.auth?.method !== "session") {
    throw new ApiError(403, "forbidden", "A browser session is required.");
  }
  return request.auth;
}

export function registerOAuthGrantRoutes(
  app: FastifyInstance,
  store: ProjectStore,
  oauthStore: OAuthStore,
  hooks: AuthHooks,
  now: () => string = () => new Date().toISOString(),
): void {
  app.get<{ Params: ProjectParams }>(
    "/api/v1/projects/:id/oauth-grants",
    { preHandler: hooks.requireSession },
    async (request, reply) => {
      const auth = sessionAuth(request);
      if (!store.getProject(auth.user.id, request.params.id)) {
        throw new ApiError(404, "not_found", "The project does not exist.");
      }
      reply.header("Cache-Control", "no-store");
      return {
        grants: oauthStore
          .listGrants(auth.user.id, request.params.id)
          .map(oauthGrantJson),
      };
    },
  );

  app.delete<{ Params: GrantParams }>(
    "/api/v1/projects/:id/oauth-grants/:grantId",
    { preHandler: hooks.requireSession },
    async (request, reply) => {
      const auth = sessionAuth(request);
      if (!store.getProject(auth.user.id, request.params.id)) {
        throw new ApiError(404, "not_found", "The project does not exist.");
      }
      const revoked = oauthStore.revokeGrantForUser(
        auth.user.id,
        request.params.id,
        request.params.grantId,
        now(),
      );
      if (!revoked) {
        throw new ApiError(
          404,
          "not_found",
          "The OAuth connection does not exist.",
        );
      }
      return reply.code(204).send();
    },
  );
}
