import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import type { ServerConfig } from "../config";
import type { AuthStore } from "../db/authStore";
import type { OAuthStore } from "../db/oauthStore";
import type { ProjectStore } from "../db/store";
import type { AuthHooks } from "../auth/middleware";
import { hashToken, normalizeScopes } from "../auth/tokens";
import type { TokenScope } from "../auth/types";
import { ApiError } from "../api/errors";
import { oauthConsentDecisionSchema, parseBody } from "../api/schemas";
import {
  authenticateClient,
  hasBasicHeader,
  requestedClientId,
} from "./clientAuth";
import {
  newAuthorizationCode,
  newClientCredentials,
  newGrantId,
  newOAuthTokens,
  newRequestId,
  verifyPkce,
} from "./crypto";
import { OAuthProtocolError } from "./errors";
import {
  normalizeResource,
  parseScopeValue,
  redirectHost,
  redirectUriMatches,
  requestedScopes,
  sameScopes,
  scopesAreSubset,
  validState,
  validateRedirectUri,
  withRedirectParams,
} from "./validation";

const FORM_CONTENT_TYPE = "application/x-www-form-urlencoded";
const MAX_CLIENTS = 500;
const TEST_MAX_CLIENTS = 5000;

const registrationSchema = z
  .object({
    redirect_uris: z.array(z.string()).min(1).max(10),
    token_endpoint_auth_method: z
      .enum(["none", "client_secret_post", "client_secret_basic"])
      .optional(),
    grant_types: z.array(z.string()).optional(),
    response_types: z.array(z.string()).optional(),
    client_name: z.string().optional(),
  })
  .passthrough();

export interface OAuthRouteOptions {
  config: ServerConfig;
  store: ProjectStore;
  authStore: AuthStore;
  oauthStore: OAuthStore;
  hooks: AuthHooks;
  now?: () => string;
}

function stringField(
  source: Record<string, unknown>,
  key: string,
): string | null {
  const value = source[key];
  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    const first = value.find(
      (item): item is string => typeof item === "string",
    );
    return first ?? null;
  }
  return null;
}

function isoAfter(now: string, seconds: number): string {
  return new Date(Date.parse(now) + seconds * 1000).toISOString();
}

function invalidRequest(description: string): OAuthProtocolError {
  return new OAuthProtocolError(400, "invalid_request", description);
}

function invalidClient(hasBasic: boolean): OAuthProtocolError {
  return new OAuthProtocolError(
    401,
    "invalid_client",
    "Client authentication failed.",
    hasBasic ? { "WWW-Authenticate": 'Basic realm="Layers"' } : undefined,
  );
}

function invalidGrant(description = "The grant is invalid or expired.") {
  return new OAuthProtocolError(400, "invalid_grant", description);
}

function invalidTarget() {
  return new OAuthProtocolError(
    400,
    "invalid_target",
    "The requested resource is not this MCP server.",
  );
}

function sessionUser(request: FastifyRequest) {
  if (request.auth?.method !== "session") {
    throw new ApiError(403, "forbidden", "A browser session is required.");
  }
  return request.auth.user;
}

function requirePendingRequest(
  oauthStore: OAuthStore,
  requestId: string,
  now: string,
) {
  const record = oauthStore.getAuthorizationRequest(requestId);
  if (!record) {
    throw new ApiError(404, "not_found", "The authorization request is gone.");
  }
  if (record.status !== "pending") {
    throw new ApiError(
      409,
      "oauth_request_decided",
      "This authorization request was already decided.",
    );
  }
  if (Date.parse(record.expiresAt) <= Date.parse(now)) {
    throw new ApiError(
      410,
      "oauth_request_expired",
      "This authorization request has expired. Return to the app and try again.",
    );
  }
  return record;
}

function authorizationRedirect(
  redirectUri: string,
  params: Record<string, string | null>,
): string {
  return withRedirectParams(redirectUri, params);
}

function formBody(request: FastifyRequest): Record<string, unknown> {
  const contentType = String(
    request.headers["content-type"] ?? "",
  ).toLowerCase();
  if (!contentType.startsWith(FORM_CONTENT_TYPE)) {
    throw invalidRequest(
      "The token endpoint accepts application/x-www-form-urlencoded only.",
    );
  }
  return (request.body ?? {}) as Record<string, unknown>;
}

function tokenResponse(
  tokens: { accessToken: string; refreshToken: string },
  scopes: TokenScope[],
  config: ServerConfig,
) {
  const oauth = config.oauth!;
  return {
    access_token: tokens.accessToken,
    token_type: "Bearer",
    expires_in: oauth.accessTokenTtlSeconds,
    refresh_token: tokens.refreshToken,
    scope: scopes.join(" "),
  };
}

function noStore(reply: FastifyReply): FastifyReply {
  return reply.header("Cache-Control", "no-store").header("Pragma", "no-cache");
}

export function registerOAuthRoutes(
  app: FastifyInstance,
  {
    config,
    store,
    authStore,
    oauthStore,
    hooks,
    now = () => new Date().toISOString(),
  }: OAuthRouteOptions,
): void {
  const oauth = config.oauth;
  if (!oauth) return;

  app.addContentTypeParser(
    FORM_CONTENT_TYPE,
    { parseAs: "string", bodyLimit: 16 * 1024 },
    (_request, body, done) => {
      try {
        const text = typeof body === "string" ? body : body.toString("utf8");
        done(null, Object.fromEntries(new URLSearchParams(text)));
      } catch (error) {
        done(error as Error);
      }
    },
  );

  const protectedResourceMetadata = {
    resource: oauth.resource,
    authorization_servers: [oauth.issuer],
    scopes_supported: ["read", "write"],
    bearer_methods_supported: ["header"],
    resource_name: "Layers",
    resource_documentation: `${oauth.issuer}/api/v1/docs`,
  };
  const authorizationServerMetadata = {
    issuer: oauth.issuer,
    authorization_endpoint: oauth.authorizeUrl,
    token_endpoint: oauth.tokenUrl,
    registration_endpoint: oauth.registerUrl,
    revocation_endpoint: oauth.revokeUrl,
    scopes_supported: ["read", "write"],
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    token_endpoint_auth_methods_supported: [
      "none",
      "client_secret_post",
      "client_secret_basic",
    ],
    revocation_endpoint_auth_methods_supported: [
      "none",
      "client_secret_post",
      "client_secret_basic",
    ],
    code_challenge_methods_supported: ["S256"],
    service_documentation: `${oauth.issuer}/api/v1/docs`,
  };

  const discovery = async (_request: FastifyRequest, reply: FastifyReply) => {
    reply.header("Cache-Control", "public, max-age=300");
    return protectedResourceMetadata;
  };
  app.get("/.well-known/oauth-protected-resource", discovery);
  app.get("/.well-known/oauth-protected-resource/mcp", discovery);
  app.get(
    "/.well-known/oauth-authorization-server",
    async (_request, reply) => {
      reply.header("Cache-Control", "public, max-age=300");
      return authorizationServerMetadata;
    },
  );

  app.get<{ Querystring: Record<string, unknown> }>(
    "/oauth/authorize",
    {
      config: {
        rateLimit: {
          max: config.testMode ? 1000 : 60,
          timeWindow: 60_000,
          hook: "preHandler",
          keyGenerator: (request) => request.ip,
        },
      },
    },
    async (request, reply) => {
      const timestamp = now();
      const clientId = stringField(request.query, "client_id");
      const client = clientId ? oauthStore.getClient(clientId) : null;
      const redirectUri = stringField(request.query, "redirect_uri");
      if (
        !client ||
        !redirectUri ||
        !client.redirectUris.some((registered) =>
          redirectUriMatches(redirectUri, registered),
        )
      ) {
        throw invalidRequest("The client or redirect URI is not registered.");
      }

      const state = stringField(request.query, "state");
      const responseType = stringField(request.query, "response_type");
      if (!validState(state)) {
        throw invalidRequest("The state value is too long.");
      }
      if (responseType !== "code") {
        reply.header("Cache-Control", "no-store");
        return reply.redirect(
          authorizationRedirect(redirectUri, {
            error: "unsupported_response_type",
            error_description: "Only response_type=code is supported.",
            state,
          }),
          302,
        );
      }

      const challenge = stringField(request.query, "code_challenge");
      const challengeMethod = stringField(
        request.query,
        "code_challenge_method",
      );
      if (
        !challenge ||
        !/^[A-Za-z0-9_-]{43,128}$/.test(challenge) ||
        challengeMethod !== "S256"
      ) {
        reply.header("Cache-Control", "no-store");
        return reply.redirect(
          authorizationRedirect(redirectUri, {
            error: "invalid_request",
            error_description: "PKCE with S256 is required.",
            state,
          }),
          302,
        );
      }

      const scopes = requestedScopes(stringField(request.query, "scope"));
      if (!scopes) {
        reply.header("Cache-Control", "no-store");
        return reply.redirect(
          authorizationRedirect(redirectUri, {
            error: "invalid_scope",
            error_description: "The requested scope is not supported.",
            state,
          }),
          302,
        );
      }

      const resource = normalizeResource(
        stringField(request.query, "resource"),
        oauth,
      );
      if (!resource) {
        reply.header("Cache-Control", "no-store");
        return reply.redirect(
          authorizationRedirect(redirectUri, {
            error: "invalid_target",
            error_description: "The requested resource is not this MCP server.",
            state,
          }),
          302,
        );
      }

      oauthStore.pruneAuthorizationArtifacts(timestamp);
      const id = newRequestId();
      oauthStore.createAuthorizationRequest({
        id,
        clientId: client.id,
        redirectUri,
        scopes,
        state,
        codeChallenge: challenge,
        codeChallengeMethod: "S256",
        resource,
        expiresAt: isoAfter(timestamp, oauth.authorizationRequestTtlSeconds),
      });
      reply
        .header("Cache-Control", "no-store")
        .header("Referrer-Policy", "no-referrer");
      return reply.redirect(
        `${oauth.issuer}/#/oauth/consent/${encodeURIComponent(id)}`,
        302,
      );
    },
  );

  app.get<{ Params: { requestId: string } }>(
    "/api/v1/oauth/authorize/:requestId",
    { preHandler: hooks.requireSession },
    async (request, reply) => {
      const user = sessionUser(request);
      const record = requirePendingRequest(
        oauthStore,
        request.params.requestId,
        now(),
      );
      const client = oauthStore.getClient(record.clientId);
      if (!client) {
        throw new ApiError(404, "not_found", "The OAuth client is gone.");
      }
      const projects = store.listProjects(user.id).projects.map((project) => ({
        id: project.id,
        name: project.name,
        color: project.color,
      }));
      noStore(reply);
      return {
        request: {
          id: record.id,
          clientId: client.id,
          clientName: client.name,
          redirectUri: record.redirectUri,
          redirectHost: redirectHost(record.redirectUri),
          scopes: record.scopes,
          expiresAt: record.expiresAt,
        },
        projects,
      };
    },
  );

  app.post<{ Params: { requestId: string } }>(
    "/api/v1/oauth/authorize/:requestId/decision",
    { preHandler: hooks.requireSession },
    async (request, reply) => {
      const user = sessionUser(request);
      const input = parseBody(oauthConsentDecisionSchema, request.body ?? {});
      const timestamp = now();
      const record = requirePendingRequest(
        oauthStore,
        request.params.requestId,
        timestamp,
      );

      if (input.decision === "deny") {
        if (
          !oauthStore.denyAuthorizationRequest(record.id, user.id, timestamp)
        ) {
          throw new ApiError(
            409,
            "oauth_request_decided",
            "This authorization request was already decided.",
          );
        }
        noStore(reply);
        return {
          redirectTo: authorizationRedirect(record.redirectUri, {
            error: "access_denied",
            error_description: "The user denied the request.",
            state: record.state,
          }),
        };
      }

      if (!input.projectId) {
        throw new ApiError(
          422,
          "validation_failed",
          "Choose a project to authorize.",
          [{ path: "projectId", message: "A project is required." }],
        );
      }
      const project = store.getProject(user.id, input.projectId);
      if (!project) {
        throw new ApiError(404, "not_found", "The project does not exist.");
      }
      const scopes = input.scopes
        ? normalizeScopes(input.scopes)
        : record.scopes;
      if (!scopesAreSubset(scopes, record.scopes)) {
        throw new ApiError(
          422,
          "invalid_scope",
          "The granted scope must be part of the requested scope.",
        );
      }

      const code = newAuthorizationCode();
      const approved = oauthStore.approveAuthorizationRequest(
        record.id,
        user.id,
        project.id,
        {
          codeHash: code.codeHash,
          clientId: record.clientId,
          userId: user.id,
          projectId: project.id,
          scopes,
          redirectUri: record.redirectUri,
          codeChallenge: record.codeChallenge,
          resource: record.resource,
          expiresAt: isoAfter(timestamp, oauth.authorizationCodeTtlSeconds),
        },
        timestamp,
      );
      if (!approved) {
        throw new ApiError(
          409,
          "oauth_request_decided",
          "This authorization request was already decided.",
        );
      }
      noStore(reply);
      return {
        redirectTo: authorizationRedirect(record.redirectUri, {
          code: code.code,
          state: record.state,
        }),
      };
    },
  );

  app.post(
    "/oauth/token",
    {
      config: {
        rateLimit: {
          max: config.testMode ? 2000 : 120,
          timeWindow: 60_000,
          hook: "preHandler",
          keyGenerator: (request) => request.ip,
        },
      },
    },
    async (request, reply) => {
      const body = formBody(request);
      const clientId = requestedClientId(request.headers.authorization, body);
      if (!clientId) {
        throw invalidClient(hasBasicHeader(request.headers.authorization));
      }
      const client = oauthStore.getClient(clientId);
      if (!client) {
        throw invalidClient(hasBasicHeader(request.headers.authorization));
      }
      authenticateClient(client, request.headers.authorization, body);
      const timestamp = now();
      const grantType = stringField(body, "grant_type");

      if (grantType === "authorization_code") {
        const rawCode = stringField(body, "code");
        const redirectUri = stringField(body, "redirect_uri");
        const verifier = stringField(body, "code_verifier");
        if (!rawCode || !redirectUri || !verifier) {
          throw invalidRequest(
            "code, redirect_uri and code_verifier are required.",
          );
        }
        const code = oauthStore.getAuthorizationCode(hashToken(rawCode));
        if (
          !code ||
          code.clientId !== client.id ||
          code.consumedAt ||
          Date.parse(code.expiresAt) <= Date.parse(timestamp)
        ) {
          throw invalidGrant("The authorization code is invalid or expired.");
        }
        if (code.redirectUri !== redirectUri) {
          throw invalidGrant("The redirect URI does not match.");
        }
        if (!verifyPkce(verifier, code.codeChallenge)) {
          throw invalidGrant("The PKCE verifier is invalid.");
        }
        const resource = normalizeResource(
          stringField(body, "resource"),
          oauth,
        );
        if (!resource || resource !== code.resource) {
          throw invalidTarget();
        }
        const codeUser = authStore.getUser(code.userId);
        if (!codeUser || codeUser.disabledAt) {
          throw invalidGrant("The account can no longer authorize this app.");
        }
        const tokens = newOAuthTokens();
        const grant = oauthStore.createGrantForCode(code.codeHash, timestamp, {
          id: newGrantId(),
          clientId: client.id,
          userId: code.userId,
          projectId: code.projectId,
          scopes: code.scopes,
          resource: code.resource,
          accessTokenHash: tokens.accessTokenHash,
          refreshTokenHash: tokens.refreshTokenHash,
          accessExpiresAt: isoAfter(timestamp, oauth.accessTokenTtlSeconds),
          refreshExpiresAt: isoAfter(timestamp, oauth.refreshTokenTtlSeconds),
        });
        if (!grant) throw invalidGrant();
        oauthStore.touchClient(client.id, timestamp);
        noStore(reply);
        return tokenResponse(tokens, grant.scopes, config);
      }

      if (grantType === "refresh_token") {
        const rawRefresh = stringField(body, "refresh_token");
        if (!rawRefresh) throw invalidRequest("refresh_token is required.");
        const refreshHash = hashToken(rawRefresh);
        const reused =
          oauthStore.findGrantByPreviousRefreshTokenHash(refreshHash);
        if (reused) {
          oauthStore.revokeGrant(reused.id, timestamp);
          throw invalidGrant("The refresh token was already used.");
        }
        const grant = oauthStore.findGrantByRefreshTokenHash(refreshHash);
        if (
          !grant ||
          grant.clientId !== client.id ||
          grant.revokedAt ||
          Date.parse(grant.refreshExpiresAt) <= Date.parse(timestamp)
        ) {
          throw invalidGrant("The refresh token is invalid or expired.");
        }
        const grantUser = authStore.getUser(grant.userId);
        if (!grantUser || grantUser.disabledAt) {
          oauthStore.revokeGrant(grant.id, timestamp);
          throw invalidGrant("The account can no longer authorize this app.");
        }
        const requestedScope = stringField(body, "scope");
        if (requestedScope && requestedScope.trim()) {
          const parsed = parseScopeValue(requestedScope);
          if (!parsed || !sameScopes(parsed, grant.scopes)) {
            throw new OAuthProtocolError(
              400,
              "invalid_scope",
              "The refresh request cannot change the granted scope.",
            );
          }
        }
        const resource = normalizeResource(
          stringField(body, "resource"),
          oauth,
        );
        if (!resource || resource !== grant.resource) throw invalidTarget();
        const tokens = newOAuthTokens();
        const rotated = oauthStore.rotateGrant({
          id: grant.id,
          accessTokenHash: tokens.accessTokenHash,
          refreshTokenHash: tokens.refreshTokenHash,
          previousRefreshTokenHash: refreshHash,
          accessExpiresAt: isoAfter(timestamp, oauth.accessTokenTtlSeconds),
          lastUsedAt: timestamp,
        });
        if (!rotated) throw invalidGrant();
        oauthStore.touchClient(client.id, timestamp);
        noStore(reply);
        return tokenResponse(tokens, grant.scopes, config);
      }

      throw new OAuthProtocolError(
        400,
        "unsupported_grant_type",
        "Only authorization_code and refresh_token are supported.",
      );
    },
  );

  app.post(
    "/oauth/register",
    {
      config: {
        rateLimit: {
          max: config.testMode ? 1000 : 20,
          timeWindow: 60 * 60 * 1000,
          hook: "preHandler",
          keyGenerator: (request) => request.ip,
        },
      },
    },
    async (request, reply) => {
      const parsed = registrationSchema.safeParse(request.body ?? {});
      if (!parsed.success) {
        throw new OAuthProtocolError(
          400,
          "invalid_client_metadata",
          "The client metadata is invalid.",
        );
      }
      const input = parsed.data;
      const redirectUris = Array.from(new Set(input.redirect_uris));
      for (const uri of redirectUris) {
        const error = validateRedirectUri(uri);
        if (error) {
          throw new OAuthProtocolError(400, "invalid_redirect_uri", error);
        }
      }
      const grantTypes = input.grant_types ?? [
        "authorization_code",
        "refresh_token",
      ];
      if (
        !grantTypes.length ||
        grantTypes.some(
          (value) =>
            value !== "authorization_code" && value !== "refresh_token",
        )
      ) {
        throw new OAuthProtocolError(
          400,
          "invalid_client_metadata",
          "Only authorization_code and refresh_token are supported.",
        );
      }
      const responseTypes = input.response_types ?? ["code"];
      if (
        !responseTypes.length ||
        responseTypes.some((value) => value !== "code")
      ) {
        throw new OAuthProtocolError(
          400,
          "invalid_client_metadata",
          "Only response_type=code is supported.",
        );
      }
      const authMethod =
        input.token_endpoint_auth_method ?? "client_secret_basic";
      const timestamp = now();
      oauthStore.pruneAuthorizationArtifacts(timestamp);
      oauthStore.pruneUnusedClients(isoAfter(timestamp, -30 * 24 * 60 * 60));
      const maxClients = config.testMode ? TEST_MAX_CLIENTS : MAX_CLIENTS;
      if (oauthStore.countClients() >= maxClients) {
        throw new OAuthProtocolError(
          503,
          "temporarily_unavailable",
          "Too many OAuth clients are registered. Try again later.",
        );
      }
      const credentials = newClientCredentials(authMethod !== "none");
      const rawName = Array.from(input.client_name ?? "")
        .map((character) => {
          const code = character.charCodeAt(0);
          return code < 0x20 || code === 0x7f ? " " : character;
        })
        .join("")
        .trim()
        .slice(0, 100);
      const client = oauthStore.createClient({
        id: credentials.id,
        name: rawName || "MCP client",
        redirectUris,
        grantTypes,
        responseTypes,
        tokenEndpointAuthMethod: authMethod,
        clientSecretHash: credentials.secretHash,
      });
      oauthStore.touchClient(client.id, timestamp);
      noStore(reply);
      return reply.code(201).send({
        client_id: client.id,
        client_id_issued_at: Math.floor(Date.parse(client.createdAt) / 1000),
        ...(credentials.secret
          ? {
              client_secret: credentials.secret,
              client_secret_expires_at: 0,
            }
          : {}),
        redirect_uris: client.redirectUris,
        token_endpoint_auth_method: client.tokenEndpointAuthMethod,
        grant_types: client.grantTypes,
        response_types: client.responseTypes,
        client_name: client.name,
      });
    },
  );

  app.post(
    "/oauth/revoke",
    {
      config: {
        rateLimit: {
          max: config.testMode ? 2000 : 120,
          timeWindow: 60_000,
          hook: "preHandler",
          keyGenerator: (request) => request.ip,
        },
      },
    },
    async (request, reply) => {
      const body = formBody(request);
      const clientId = requestedClientId(request.headers.authorization, body);
      if (!clientId) {
        throw invalidClient(hasBasicHeader(request.headers.authorization));
      }
      const client = oauthStore.getClient(clientId);
      if (!client) {
        throw invalidClient(hasBasicHeader(request.headers.authorization));
      }
      authenticateClient(client, request.headers.authorization, body);
      const rawToken = stringField(body, "token");
      if (!rawToken) throw invalidRequest("token is required.");
      oauthStore.revokeGrantForClient(client.id, hashToken(rawToken), now());
      noStore(reply);
      return reply.code(200).send();
    },
  );
}
