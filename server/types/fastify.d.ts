import type { AuthContext } from "../auth/types";

declare module "fastify" {
  interface FastifyRequest {
    auth?: AuthContext;
  }
}
