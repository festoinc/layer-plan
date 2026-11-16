import type { FastifyInstance, FastifyRequest } from "fastify";
import type { AuthStore } from "../../db/authStore";
import type { ProjectStore } from "../../db/store";
import type { AuthHooks } from "../../auth/middleware";
import type { AuthContext } from "../../auth/types";
import {
  createApiTokenCredential,
  DEFAULT_API_TOKEN_EXPIRY_DAYS,
  MAX_ACTIVE_API_TOKENS,
} from "../../auth/tokens";
import { ApiError } from "../errors";
import { createTokenSchema, parseBody } from "../schemas";
import { apiTokenJson } from "../serializers";

interface ProjectParams {
  id: string;
}

interface TokenParams extends ProjectParams {
  tokenId: string;
}

function sessionAuth(
  request: FastifyRequest,
): Extract<AuthContext, { method: "session" }> {
  if (request.auth?.method !== "session") {
    throw new ApiError(403, "forbidden", "A browser session is required.");
  }
  return request.auth;
}

export function registerProjectTokenRoutes(
  app: FastifyInstance,
  store: ProjectStore,
  authStore: AuthStore,
  hooks: AuthHooks,
  now: () => string = () => new Date().toISOString(),
): void {
  app.get<{ Params: ProjectParams }>(
    "/api/v1/projects/:id/tokens",
    { preHandler: hooks.requireSession },
    async (request, reply) => {
      const auth = sessionAuth(request);
      if (!store.getProject(auth.user.id, request.params.id)) {
        throw new ApiError(404, "not_found", "The project does not exist.");
      }
      reply.header("Cache-Control", "no-store");
      return {
        tokens: authStore
          .listApiTokens(auth.user.id, request.params.id)
          .map(apiTokenJson),
      };
    },
  );

  app.post<{ Params: ProjectParams }>(
    "/api/v1/projects/:id/tokens",
    { preHandler: hooks.requireSession },
    async (request, reply) => {
      const auth = sessionAuth(request);
      if (!store.getProject(auth.user.id, request.params.id)) {
        throw new ApiError(404, "not_found", "The project does not exist.");
      }
      const input = parseBody(createTokenSchema, request.body ?? {});
      if (authStore.countApiTokens(auth.user.id) >= MAX_ACTIVE_API_TOKENS) {
        throw new ApiError(
          409,
          "token_limit",
          `The API key limit is ${MAX_ACTIVE_API_TOKENS} active keys.`,
        );
      }
      const credential = createApiTokenCredential();
      const expiresInDays =
        input.expiresInDays ?? DEFAULT_API_TOKEN_EXPIRY_DAYS;
      const expiresAt = new Date(
        Date.parse(now()) + expiresInDays * 24 * 60 * 60 * 1000,
      ).toISOString();
      const token = authStore.createApiToken({
        id: credential.id,
        userId: auth.user.id,
        projectId: request.params.id,
        name: input.name,
        prefix: credential.prefix,
        tokenHash: credential.tokenHash,
        scopes: input.scopes ?? ["read", "write"],
        expiresAt,
      });
      reply.header("Cache-Control", "no-store");
      return reply.code(201).send({
        token: credential.token,
        tokenInfo: apiTokenJson(token),
      });
    },
  );

  app.delete<{ Params: TokenParams }>(
    "/api/v1/projects/:id/tokens/:tokenId",
    { preHandler: hooks.requireSession },
    async (request, reply) => {
      const auth = sessionAuth(request);
      if (!store.getProject(auth.user.id, request.params.id)) {
        throw new ApiError(404, "not_found", "The project does not exist.");
      }
      const revoked = authStore.revokeApiToken(
        auth.user.id,
        request.params.id,
        request.params.tokenId,
      );
      if (!revoked) {
        throw new ApiError(404, "not_found", "The API key does not exist.");
      }
      return reply.code(204).send();
    },
  );
}
