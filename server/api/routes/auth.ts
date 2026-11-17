import type { FastifyInstance } from "fastify";
import type { ServerConfig } from "../../config";
import type { AuthStore } from "../../db/authStore";
import type { AuthHooks } from "../../auth/middleware";
import { SESSION_COOKIE, sessionExpiry } from "../../auth/middleware";
import type { PasswordHasher } from "../../auth/password";
import { createSessionCredential, hashToken } from "../../auth/tokens";
import { ApiError } from "../errors";
import { changePasswordSchema, loginSchema, parseBody } from "../schemas";
import { loginSessionJson, sessionJson, userJson } from "../serializers";

export interface AuthRouteOptions {
  config: ServerConfig;
  authStore: AuthStore;
  hooks: AuthHooks;
  passwordHasher: PasswordHasher;
}

function cookieOptions(config: ServerConfig) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: config.secureCookies,
    path: "/",
    maxAge: config.sessionTtlDays * 24 * 60 * 60,
  };
}

export function registerAuthRoutes(
  app: FastifyInstance,
  { config, authStore, hooks, passwordHasher }: AuthRouteOptions,
) {
  app.post(
    "/api/v1/auth/login",
    {
      config: {
        rateLimit: {
          max: config.loginRateLimit,
          timeWindow: config.loginRateWindowMinutes * 60 * 1000,
          hook: "preHandler",
          keyGenerator: (request) => {
            const body = request.body as { email?: string } | undefined;
            return `${request.ip}:${body?.email?.trim().toLowerCase() ?? ""}`;
          },
        },
      },
    },
    async (request, reply) => {
      const input = parseBody(loginSchema, request.body);
      const email = input.email.trim().toLowerCase();
      const user = authStore.getUserByEmail(email);
      if (!user) {
        await passwordHasher.verifyDummy(input.password);
        throw new ApiError(
          401,
          "invalid_credentials",
          "The email or password is incorrect.",
        );
      }
      const valid = await passwordHasher.verify(
        user.passwordHash,
        input.password,
      );
      if (!valid) {
        throw new ApiError(
          401,
          "invalid_credentials",
          "The email or password is incorrect.",
        );
      }
      if (user.disabledAt) {
        throw new ApiError(
          403,
          "account_disabled",
          "This account is disabled.",
        );
      }

      const credential = createSessionCredential();
      const now = new Date().toISOString();
      const session = authStore.createSession({
        id: credential.id,
        userId: user.id,
        tokenHash: credential.tokenHash,
        expiresAt: sessionExpiry(now, config.sessionTtlDays),
        userAgent: (request.headers["user-agent"] ?? "").slice(0, 200) || null,
      });
      reply.setCookie(SESSION_COOKIE, credential.token, cookieOptions(config));
      reply.header("Cache-Control", "no-store");
      return {
        user: userJson(user),
        session: loginSessionJson(session),
      };
    },
  );

  app.post("/api/v1/auth/logout", async (request, reply) => {
    const token = request.cookies?.[SESSION_COOKIE];
    if (token) {
      const session = authStore.findSessionByTokenHash(hashToken(token));
      if (session) authStore.deleteSession(session.id);
    }
    reply.clearCookie(SESSION_COOKIE, { path: "/" });
    reply.header("Cache-Control", "no-store");
    return reply.code(204).send();
  });

  app.get(
    "/api/v1/auth/session",
    { preHandler: hooks.requireSession },
    async (request, reply) => {
      if (request.auth?.method !== "session") {
        throw new ApiError(403, "forbidden", "A browser session is required.");
      }
      const session = authStore.getSession(request.auth.sessionId);
      if (!session) {
        throw new ApiError(
          401,
          "unauthenticated",
          "The session no longer exists.",
        );
      }
      reply.header("Cache-Control", "no-store");
      return {
        user: userJson(request.auth.user),
        session: loginSessionJson(session),
      };
    },
  );

  app.get("/api/v1/me", { preHandler: hooks.requireAuth }, async (request) => ({
    user: request.auth!.user,
  }));

  app.post(
    "/api/v1/me/password",
    {
      preHandler: hooks.requireSession,
      config: {
        rateLimit: {
          max: config.loginRateLimit,
          timeWindow: config.loginRateWindowMinutes * 60 * 1000,
          hook: "preHandler",
          keyGenerator: (request) => request.ip,
        },
      },
    },
    async (request, reply) => {
      const auth = request.auth;
      if (auth?.method !== "session") {
        throw new ApiError(403, "forbidden", "A browser session is required.");
      }
      if (auth.user.role !== "super_admin") {
        throw new ApiError(
          403,
          "forbidden",
          "Only the super admin can change the password.",
        );
      }
      const input = parseBody(changePasswordSchema, request.body);
      const user = authStore.getUser(auth.user.id);
      if (!user) {
        throw new ApiError(401, "unauthenticated", "Sign in to continue.");
      }
      const valid = await passwordHasher.verify(
        user.passwordHash,
        input.currentPassword,
      );
      if (!valid) {
        throw new ApiError(
          403,
          "invalid_credentials",
          "The current password is incorrect.",
        );
      }
      if (input.currentPassword === input.newPassword) {
        throw new ApiError(
          422,
          "password_unchanged",
          "Choose a new password that differs from the current password.",
        );
      }
      const passwordHash = await passwordHasher.hash(input.newPassword);
      authStore.updateUserPassword(user.id, passwordHash);
      authStore.deleteOtherSessions(user.id, auth.sessionId);
      reply.header("Cache-Control", "no-store");
      return reply.code(204).send();
    },
  );

  app.get(
    "/api/v1/auth/sessions",
    { preHandler: hooks.requireSession },
    async (request, reply) => {
      if (request.auth?.method !== "session") {
        throw new ApiError(403, "forbidden", "A browser session is required.");
      }
      const sessionId = request.auth.sessionId;
      reply.header("Cache-Control", "no-store");
      return {
        sessions: authStore
          .listSessions(request.auth.user.id)
          .map((session) => sessionJson(session, sessionId)),
      };
    },
  );

  app.delete<{ Params: { id: string } }>(
    "/api/v1/auth/sessions/:id",
    { preHandler: hooks.requireSession },
    async (request, reply) => {
      if (request.auth?.method !== "session") {
        throw new ApiError(403, "forbidden", "A browser session is required.");
      }
      const sessions = authStore.listSessions(request.auth.user.id);
      const target = sessions.find(
        (session) => session.id === request.params.id,
      );
      if (!target) {
        throw new ApiError(404, "not_found", "The session does not exist.");
      }
      authStore.deleteSession(target.id);
      if (target.id === request.auth.sessionId) {
        reply.clearCookie(SESSION_COOKIE, { path: "/" });
      }
      return reply.code(204).send();
    },
  );

  app.delete(
    "/api/v1/auth/sessions",
    { preHandler: hooks.requireSession },
    async (request, reply) => {
      if (request.auth?.method !== "session") {
        throw new ApiError(403, "forbidden", "A browser session is required.");
      }
      authStore.deleteOtherSessions(
        request.auth.user.id,
        request.auth.sessionId,
      );
      return reply.code(204).send();
    },
  );
}
