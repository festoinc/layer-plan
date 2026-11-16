import type {
  FastifyReply,
  FastifyRequest,
  preHandlerHookHandler,
} from "fastify";
import type { ServerConfig } from "../config";
import type { AuthStore } from "../db/authStore";
import { ApiError } from "../api/errors";
import { hashToken, tokenAllows } from "./tokens";
import { publicUser } from "./types";

const SESSION_COOKIE = "layers_session";
const TOUCH_INTERVAL_MS = 60 * 60 * 1000;
const TOKEN_TOUCH_INTERVAL_MS = 5 * 60 * 1000;

export interface AuthHookOptions {
  config: ServerConfig;
  authStore: AuthStore;
  now?: () => string;
}

export interface AuthHooks {
  requireAuth: preHandlerHookHandler;
  requireMcpToken: preHandlerHookHandler;
  requireSession: preHandlerHookHandler;
  requireSuperAdmin: preHandlerHookHandler;
}

function unauthenticated(message = "Sign in to continue."): ApiError {
  return new ApiError(401, "unauthenticated", message);
}

function sessionExpiry(now: string, ttlDays: number): string {
  return new Date(
    Date.parse(now) + ttlDays * 24 * 60 * 60 * 1000,
  ).toISOString();
}

function allowedOrigins(
  request: FastifyRequest,
  config: ServerConfig,
): Set<string> {
  const origins = new Set(config.uiOrigins);
  origins.add(`http://${request.host}`);
  origins.add(`https://${request.host}`);
  return origins;
}

function assertOrigin(request: FastifyRequest, config: ServerConfig): void {
  if (request.method === "GET" || request.method === "HEAD") return;
  if (request.method === "OPTIONS") return;
  const origin = request.headers.origin;
  if (!origin) return;
  if (!allowedOrigins(request, config).has(origin)) {
    throw new ApiError(
      403,
      "invalid_origin",
      "This request must come from the configured Layers UI origin.",
    );
  }
}

export function createAuthHooks({
  config,
  authStore,
  now = () => new Date().toISOString(),
}: AuthHookOptions): AuthHooks {
  const authenticate = async (
    request: FastifyRequest,
    mcp = false,
  ): Promise<void> => {
    const authorization = request.headers.authorization;
    if (authorization) {
      const match = /^Bearer\s+(.+)$/i.exec(authorization.trim());
      if (!match) throw unauthenticated("The bearer token is invalid.");
      const token = authStore.findApiTokenByHash(hashToken(match[1].trim()));
      const timestamp = now();
      if (
        !token ||
        token.revokedAt ||
        (token.expiresAt &&
          Date.parse(token.expiresAt) <= Date.parse(timestamp))
      ) {
        throw unauthenticated("The API token is invalid or expired.");
      }
      const user = authStore.getUser(token.userId);
      if (!user || user.disabledAt) {
        throw unauthenticated("The account is disabled.");
      }
      if (!mcp && !tokenAllows(token.scopes, request.method)) {
        throw new ApiError(
          403,
          "forbidden",
          "The API token does not allow this operation.",
          { requiredScope: request.method === "GET" ? "read" : "write" },
        );
      }
      if (
        !token.lastUsedAt ||
        Date.parse(timestamp) - Date.parse(token.lastUsedAt) >
          TOKEN_TOUCH_INTERVAL_MS
      ) {
        authStore.touchApiToken(token.id, timestamp);
      }
      request.auth = {
        method: "token",
        user: publicUser(user),
        tokenId: token.id,
        scopes: token.scopes,
      };
      return;
    }

    if (mcp) throw unauthenticated("An API bearer token is required.");
    const rawToken = request.cookies?.[SESSION_COOKIE];
    if (!rawToken) throw unauthenticated();
    const session = authStore.findSessionByTokenHash(hashToken(rawToken));
    const timestamp = now();
    if (!session || Date.parse(session.expiresAt) <= Date.parse(timestamp)) {
      if (session) authStore.deleteSession(session.id);
      throw unauthenticated("The session expired. Sign in again.");
    }
    const user = authStore.getUser(session.userId);
    if (!user || user.disabledAt) {
      authStore.deleteSession(session.id);
      throw unauthenticated("The account is disabled.");
    }
    if (
      !session.lastSeenAt ||
      Date.parse(timestamp) - Date.parse(session.lastSeenAt) > TOUCH_INTERVAL_MS
    ) {
      authStore.touchSession(
        session.id,
        timestamp,
        sessionExpiry(timestamp, config.sessionTtlDays),
      );
    }
    request.auth = {
      method: "session",
      user: publicUser(user),
      sessionId: session.id,
    };
    assertOrigin(request, config);
  };

  const requireAuth: preHandlerHookHandler = async (request) => {
    await authenticate(request);
  };

  const requireMcpToken: preHandlerHookHandler = async (request) => {
    await authenticate(request, true);
  };

  const requireSession: preHandlerHookHandler = async (request) => {
    await authenticate(request);
    if (request.auth?.method !== "session") {
      throw new ApiError(
        403,
        "forbidden",
        "This endpoint requires a browser session, not an API token.",
      );
    }
  };

  const requireSuperAdmin: preHandlerHookHandler = async (
    request: FastifyRequest,
    _reply: FastifyReply,
  ) => {
    await authenticate(request);
    if (request.auth?.method !== "session") {
      throw new ApiError(
        403,
        "forbidden",
        "This endpoint requires a browser session, not an API token.",
      );
    }
    if (request.auth.user.role !== "super_admin") {
      throw new ApiError(
        403,
        "forbidden",
        "Only the super admin can manage users.",
      );
    }
  };

  return { requireAuth, requireMcpToken, requireSession, requireSuperAdmin };
}

export { SESSION_COOKIE, sessionExpiry };
