import path from "node:path";
import type { FastifyInstance, InjectOptions } from "fastify";
import { buildApp } from "../../server/app";
import { loadConfig, type ServerConfig } from "../../server/config";
import { createPasswordHasher } from "../../server/auth/password";
import { openDatabase, type DatabaseConnection } from "../../server/db/client";
import { runMigrations } from "../../server/db/migrate";
import { SqliteAuthStore } from "../../server/db/authStore";
import { SqliteOAuthStore } from "../../server/db/oauthStore";
import { SqliteStore } from "../../server/db/store";
import { bootstrap } from "../../server/db/bootstrap";

export const FIXED_NOW = "2026-01-01T00:00:00.000Z";
export const TEST_SUPER_ADMIN = {
  email: "super@example.test",
  password: "test-super-admin-password",
  displayName: "Super Admin",
};

function idFactory() {
  let counter = 0;
  return () => `id-${(counter += 1)}`;
}

export interface TestApi {
  app: FastifyInstance;
  store: SqliteStore;
  authStore: SqliteAuthStore;
  oauthStore: SqliteOAuthStore;
  config: ServerConfig;
  db: DatabaseConnection;
  close: () => Promise<void>;
  login: (email: string, password: string) => Promise<TestLogin>;
  createMember: (
    superCookie: string,
    input?: {
      email?: string;
      password?: string;
      displayName?: string;
    },
  ) => Promise<{ user: TestUser; cookie: string; password: string }>;
  createToken: (
    cookie: string,
    projectId: string,
    input?: {
      name?: string;
      scopes?: Array<"read" | "write">;
      expiresInDays?: number;
    },
  ) => Promise<string>;
}

export interface TestUser {
  id: string;
  email: string;
  displayName: string;
  role: "super_admin" | "member";
  createdAt: string;
  disabledAt: string | null;
}

export interface TestLogin {
  cookie: string;
  user: TestUser;
}

function cookieFrom(response: { headers: Record<string, unknown> }): string {
  const raw = response.headers["set-cookie"];
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (typeof value !== "string") {
    throw new Error("The response did not set a cookie.");
  }
  return value.split(";")[0];
}

export async function createTestApi(
  options: {
    seed?: boolean;
    loginRateLimit?: number;
    publicUrl?: string;
  } = {},
): Promise<TestApi> {
  const config = loadConfig(
    {
      ...process.env,
      LAYERS_DB_PATH: ":memory:",
      LAYERS_PUBLIC_URL: options.publicUrl ?? "",
      LAYERS_SEED_SAMPLES: options.seed === false ? "0" : "1",
      LAYERS_TEST_MODE: "1",
      LAYERS_LOGIN_RATE_LIMIT: String(options.loginRateLimit ?? 1000),
      LAYERS_SUPER_ADMIN_EMAIL: TEST_SUPER_ADMIN.email,
      LAYERS_SUPER_ADMIN_PASSWORD: TEST_SUPER_ADMIN.password,
      LAYERS_SUPER_ADMIN_NAME: TEST_SUPER_ADMIN.displayName,
    },
    { requireAuth: true },
  );
  config.staticRoot = path.resolve("test-results/does-not-exist");
  config.openapiPath = path.resolve("server/api/openapi.yaml");

  const db = openDatabase(":memory:");
  runMigrations(db);
  const store = new SqliteStore(db, {
    now: () => FIXED_NOW,
    newId: idFactory(),
  });
  const authStore = new SqliteAuthStore(db, {
    now: () => FIXED_NOW,
    newId: idFactory(),
  });
  const oauthStore = new SqliteOAuthStore(db, {
    now: () => FIXED_NOW,
    newId: idFactory(),
  });
  const passwordHasher = createPasswordHasher({ testMode: true });
  await bootstrap({ config, store, authStore, passwordHasher });

  const app = await buildApp({
    config,
    store,
    authStore,
    oauthStore,
    passwordHasher,
    logger: false,
    now: () => FIXED_NOW,
  });
  await app.ready();

  async function login(email: string, password: string): Promise<TestLogin> {
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      payload: { email, password },
      headers: { "content-type": "application/json" },
    });
    if (response.statusCode !== 200) {
      throw new Error(
        `Login failed for ${email}: ${response.statusCode} ${response.payload}`,
      );
    }
    const body = json(response) as { user: TestUser };
    return { cookie: cookieFrom(response), user: body.user };
  }

  async function createMember(
    superCookie: string,
    input: {
      email?: string;
      password?: string;
      displayName?: string;
    } = {},
  ): Promise<{ user: TestUser; cookie: string; password: string }> {
    const email = input.email ?? "member@example.test";
    const password = input.password ?? "member-password-123";
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/users",
      payload: {
        email,
        password,
        displayName: input.displayName ?? "Member",
      },
      headers: authHeaders(superCookie),
    });
    if (response.statusCode !== 201) {
      throw new Error(
        `Create member failed: ${response.statusCode} ${response.payload}`,
      );
    }
    const body = json(response) as { user: TestUser };
    const loginResult = await login(email, password);
    return { user: body.user, cookie: loginResult.cookie, password };
  }

  async function createToken(
    cookie: string,
    projectId: string,
    input: {
      name?: string;
      scopes?: Array<"read" | "write">;
      expiresInDays?: number;
    } = {},
  ): Promise<string> {
    const response = await app.inject({
      method: "POST",
      url: `/api/v1/projects/${encodeURIComponent(projectId)}/tokens`,
      payload: {
        name: input.name ?? "Test API key",
        scopes: input.scopes ?? ["read", "write"],
        ...(input.expiresInDays === undefined
          ? {}
          : { expiresInDays: input.expiresInDays }),
      },
      headers: authHeaders(cookie),
    });
    if (response.statusCode !== 201) {
      throw new Error(
        `Create token failed: ${response.statusCode} ${response.payload}`,
      );
    }
    return (json(response) as { token: string }).token;
  }

  return {
    app,
    store,
    authStore,
    oauthStore,
    config,
    db,
    login,
    createMember,
    createToken,
    close: async () => {
      await app.close();
    },
  };
}

export function authHeaders(cookie: string): Record<string, string> {
  return { cookie };
}

export function bearerHeaders(token: string): Record<string, string> {
  return { authorization: `Bearer ${token}` };
}

export async function mcpRpc(
  testApi: TestApi,
  token: string,
  method: string,
  params: object = {},
) {
  const response = await testApi.app.inject({
    method: "POST",
    url: "/mcp",
    headers: {
      authorization: `Bearer ${token}`,
      accept: "application/json, text/event-stream",
      "content-type": "application/json",
      host: "localhost",
    },
    payload: { jsonrpc: "2.0", id: 1, method, params },
  });
  return { status: response.statusCode, body: JSON.parse(response.payload) };
}

export async function mcpCall(
  testApi: TestApi,
  token: string,
  name: string,
  args: object = {},
) {
  const result = await mcpRpc(testApi, token, "tools/call", {
    name,
    arguments: args,
  });
  return {
    ...result,
    envelope: JSON.parse(result.body.result.content[0].text),
  };
}

export function json(response: { payload: string }) {
  return JSON.parse(response.payload);
}

export function docRequest(
  body: object,
  headers: Record<string, string> = {},
): InjectOptions {
  return {
    payload: body,
    headers: { "content-type": "application/json", ...headers },
  };
}
