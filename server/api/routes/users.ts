import type { FastifyInstance } from "fastify";
import type { AuthStore } from "../../db/authStore";
import type { AuthHooks } from "../../auth/middleware";
import type { PasswordHasher } from "../../auth/password";
import { ApiError } from "../errors";
import { createUserSchema, parseBody, updateUserSchema } from "../schemas";
import { userJson } from "../serializers";

function defaultDisplayName(email: string): string {
  const local = email.split("@")[0] ?? "Member";
  return local.slice(0, 80) || "Member";
}

function isUniqueEmailError(error: unknown): boolean {
  return (
    error instanceof Error &&
    /UNIQUE constraint failed: users\.email/i.test(error.message)
  );
}

export function registerUserRoutes(
  app: FastifyInstance,
  authStore: AuthStore,
  hooks: AuthHooks,
  passwordHasher: PasswordHasher,
) {
  app.get(
    "/api/v1/users",
    { preHandler: hooks.requireSuperAdmin },
    async () => ({ users: authStore.listUsers().map(userJson) }),
  );

  app.post(
    "/api/v1/users",
    { preHandler: hooks.requireSuperAdmin },
    async (request, reply) => {
      const input = parseBody(createUserSchema, request.body);
      const email = input.email.trim().toLowerCase();
      if (authStore.getUserByEmail(email)) {
        throw new ApiError(409, "email_taken", "That email is already in use.");
      }
      try {
        const user = authStore.createUser({
          email,
          displayName: input.displayName ?? defaultDisplayName(email),
          passwordHash: await passwordHasher.hash(input.password),
        });
        return reply.code(201).send({ user: userJson(user) });
      } catch (error) {
        if (isUniqueEmailError(error)) {
          throw new ApiError(
            409,
            "email_taken",
            "That email is already in use.",
          );
        }
        throw error;
      }
    },
  );

  app.patch<{ Params: { id: string } }>(
    "/api/v1/users/:id",
    { preHandler: hooks.requireSuperAdmin },
    async (request) => {
      const input = parseBody(updateUserSchema, request.body);
      const target = authStore.getUser(request.params.id);
      if (!target) {
        throw new ApiError(404, "not_found", "The user does not exist.");
      }
      if (
        request.auth?.method === "session" &&
        request.auth.user.id === target.id &&
        input.disabled
      ) {
        throw new ApiError(
          403,
          "forbidden",
          "The super admin cannot disable its own account.",
        );
      }
      const user = authStore.setUserDisabled(target.id, input.disabled);
      return { user: userJson(user) };
    },
  );
}
