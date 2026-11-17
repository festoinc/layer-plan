import type {
  FastifyReply,
  FastifyRequest,
  preHandlerHookHandler,
} from "fastify";
import type { ServerConfig } from "../config";
import type { AuthStore } from "../db/authStore";
import type { OAuthStore } from "../db/oauthStore";
import { ApiError } from "../api/errors";
import { INTERNAL_AUTH_HEADER, createInternalAuth } from "./internal";
import type { InternalAuth } from "./internal";
import { hashToken, tokenAllows } from "./tokens";
import { publicUser } from "./types";

const SESSION_COOKIE = "layers_session";
const TOUCH_INTERVAL_MS = 60 * 60 * 1000;
const TOKEN_TOUCH_INTERVAL_MS = 5 * 60 * 1000;

export interface AuthHookOptions {
  config: ServerConfig;
  authStore: AuthStore;
  oauthStore: OAuthStore;
  now?: () => string;
}

export interface AuthHooks {
  requireAuth: preHandlerHookHandler;
  requireMcpToken: preHandlerHookHandler;
  requireSession: preHandlerHookHandler;
  requireSuperAdmin: preHandlerHookHandler;
  internalAuth: InternalAuth;
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

function projectScopeAllows(
  request: FastifyRequest,
  projectId: string,
): boolean {
  const url = (request.raw.url ?? request.url ?? "").split("?")[0] ?? "";
  if (!url.startsWith("/api/v1/projects")) return true;
  if (
    url === "/api/v1/projects" &&
    (request.method === "GET" || request.method === "HEAD")
  ) {
    return true;
  }
  const match = /^\/api\/v1\/projects\/([^/]+)/.exec(url);
  if (!match) return false;
  try {
    return decodeURIComponent(match[1]) === projectId;
  } catch {
    return false;
  }
}

function internalHeaderValue(request: FastifyRequest): string | null {
  const value = request.headers[INTERNAL_AUTH_HEADER];
  if (value === undefined) return null;
  return Array.isArray(value) ? (value[0] ?? "") : value;
}

export function createAuthHooks({
  config,
  authStore,
  oauthStore,
  now = () => new Date().toISOString(),
}: AuthHookOptions): AuthHooks {
  const internalAuth = createInternalAuth();

  const authenticate = async (
    request: FastifyRequest,
    mcp = false,
  ): Promise<void> => {
    if (!mcp) {
      const internalValue = internalHeaderValue(request);
      if (internalValue !== null) {
        const context = internalAuth.verify(internalValue);
        if (!context) {
          throw unauthenticated("The request could not be authenticated.");
        }
        const user = authStore.getUser(context.userId);
        if (!user || user.disabledAt) {
          throw unauthenticated("The account is disabled.");
        }
        if (!tokenAllows(context.scopes, request.method)) {
          throw new ApiError(
            403,
            "forbidden",
            "The API key does not allow this operation.",
            { requiredScope: request.method === "GET" ? "read" : "write" },
          );
        }
        if (!projectScopeAllows(request, context.projectId)) {
          throw new ApiError(404, "not_found", "The project does not exist.");
        }
        request.auth = {
          method: "token",
          credential: "api_key",
          user: publicUser(user),
          tokenId: context.tokenId,
          projectId: context.projectId,
          scopes: context.scopes,
        };
        return;
      }
    }

    const authorization = request.headers.authorization;
    if (authorization) {
      const match = /^Bearer\s+(.+)$/i.exec(authorization.trim());
      if (!match) throw unauthenticated("The bearer token is invalid.");
      const presented = match[1].trim();
      const timestamp = now();

      if (presented.startsWith("loa_")) {
        if (!config.oauth) {
          throw unauthenticated("OAuth is not configured for this server.");
        }
        const grant = oauthStore.findGrantByAccessTokenHash(
          hashToken(presented),
        );
        if (
          !grant ||
          grant.revokedAt ||
          Date.parse(grant.accessExpiresAt) <= Date.parse(timestamp) ||
          grant.resource !== config.oauth.resource
        ) {
          throw unauthenticated(
            "The OAuth access token is invalid or expired.",
          );
        }
        const user = authStore.getUser(grant.userId);
        if (!user || user.disabledAt) {
          throw unauthenticated("The account is disabled.");
        }
        if (!mcp) {
          throw new ApiError(
            403,
            "forbidden",
            "MCP OAuth tokens are only valid for the MCP endpoint.",
          );
        }
        if (
          !grant.lastUsedAt ||
          Date.parse(timestamp) - Date.parse(grant.lastUsedAt) >
            TOKEN_TOUCH_INTERVAL_MS
        ) {
          oauthStore.touchGrant(grant.id, timestamp);
        }
        request.auth = {
          method: "token",
          credential: "oauth",
          user: publicUser(user),
          tokenId: grant.id,
          projectId: grant.projectId,
          scopes: grant.scopes,
        };
        return;
      }

      const token = authStore.findApiTokenByHash(hashToken(presented));
      if (
        !token ||
        token.revokedAt ||
        (token.expiresAt &&
          Date.parse(token.expiresAt) <= Date.parse(timestamp))
      ) {
        throw unauthenticated("The API key is invalid or expired.");
      }
      const user = authStore.getUser(token.userId);
      if (!user || user.disabledAt) {
        throw unauthenticated("The account is disabled.");
      }
      if (!mcp) {
        throw new ApiError(
          403,
          "forbidden",
          "Project API keys are only valid for the MCP endpoint.",
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
        credential: "api_key",
        user: publicUser(user),
        tokenId: token.id,
        projectId: token.projectId,
        scopes: token.scopes,
      };
      return;
    }

    if (mcp) throw unauthenticated("A project API key is required.");
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
        "This endpoint requires a browser session, not an API key.",
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
        "This endpoint requires a browser session, not an API key.",
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

  return {
    requireAuth,
    requireMcpToken,
    requireSession,
    requireSuperAdmin,
    internalAuth,
  };
}

export { SESSION_COOKIE, sessionExpiry };
