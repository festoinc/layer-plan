import type { FastifyInstance } from "fastify";
import type { AuthStore } from "../../db/authStore";
import type { AuthHooks } from "../../auth/middleware";
import { createApiTokenCredential } from "../../auth/tokens";
import { ApiError } from "../errors";
import { createTokenSchema, parseBody } from "../schemas";
import { apiTokenJson } from "../serializers";

export function registerMeRoutes(
  app: FastifyInstance,
  authStore: AuthStore,
  hooks: AuthHooks,
) {
  app.get(
    "/api/v1/me/tokens",
    { preHandler: hooks.requireSession },
    async (request, reply) => {
      if (request.auth?.method !== "session") {
        throw new ApiError(403, "forbidden", "A browser session is required.");
      }
      reply.header("Cache-Control", "no-store");
      return {
        tokens: authStore.listApiTokens(request.auth.user.id).map(apiTokenJson),
      };
    },
  );

  app.post(
    "/api/v1/me/tokens",
    { preHandler: hooks.requireSession },
    async (request, reply) => {
      if (request.auth?.method !== "session") {
        throw new ApiError(403, "forbidden", "A browser session is required.");
      }
      const input = parseBody(createTokenSchema, request.body);
      if (authStore.countApiTokens(request.auth.user.id) >= 20) {
        throw new ApiError(
          409,
          "token_limit",
          "The API token limit is 20 active tokens.",
        );
      }
      const credential = createApiTokenCredential();
      const expiresAt = input.expiresInDays
        ? new Date(
            Date.now() + input.expiresInDays * 24 * 60 * 60 * 1000,
          ).toISOString()
        : null;
      const token = authStore.createApiToken({
        id: credential.id,
        userId: request.auth.user.id,
        name: input.name,
        prefix: credential.prefix,
        tokenHash: credential.tokenHash,
        scopes: input.scopes,
        expiresAt,
      });
      reply.header("Cache-Control", "no-store");
      return reply.code(201).send({
        token: credential.token,
        tokenInfo: apiTokenJson(token),
      });
    },
  );

  app.delete<{ Params: { id: string } }>(
    "/api/v1/me/tokens/:id",
    { preHandler: hooks.requireSession },
    async (request, reply) => {
      if (request.auth?.method !== "session") {
        throw new ApiError(403, "forbidden", "A browser session is required.");
      }
      const revoked = authStore.revokeApiToken(
        request.auth.user.id,
        request.params.id,
      );
      if (!revoked) {
        throw new ApiError(404, "not_found", "The API token does not exist.");
      }
      return reply.code(204).send();
    },
  );
}
