import path from "node:path";
import { config as loadDotenv } from "dotenv";

loadDotenv({ quiet: true });

export interface ServerConfig {
  host: string;
  port: number;
  dbPath: string;
  seedSamples: boolean;
  testMode: boolean;
  allowRemote: boolean;
  staticRoot: string;
  openapiPath: string;
  superAdminEmail: string;
  superAdminPassword: string;
  superAdminName: string;
  sessionTtlDays: number;
  secureCookies: boolean;
  uiOrigins: string[];
  loginRateLimit: number;
  loginRateWindowMinutes: number;
}

export interface LoadConfigOptions {
  requireAuth?: boolean;
}

function isLoopback(host: string): boolean {
  return (
    host === "127.0.0.1" ||
    host === "localhost" ||
    host === "::1" ||
    host === "[::1]"
  );
}

function positiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function normalizeOrigin(value: string): string {
  return value.trim().replace(/\/+$/, "");
}

export function loadConfig(
  env: NodeJS.ProcessEnv = process.env,
  options: LoadConfigOptions = {},
): ServerConfig {
  const requireAuth = options.requireAuth !== false;
  const host = env.HOST ?? "127.0.0.1";
  const allowRemote = env.LAYERS_ALLOW_REMOTE === "1";
  if (!isLoopback(host) && !allowRemote) {
    throw new Error(
      `Refusing to bind to ${host}. Set LAYERS_ALLOW_REMOTE=1 only if you understand that this API is local-only.`,
    );
  }

  const testMode = env.LAYERS_TEST_MODE === "1";
  const superAdminEmail =
    env.LAYERS_SUPER_ADMIN_EMAIL?.trim() ||
    (testMode ? "super@example.test" : "");
  const superAdminPassword =
    env.LAYERS_SUPER_ADMIN_PASSWORD ||
    (testMode ? "test-super-admin-password" : "");
  const superAdminName = (
    env.LAYERS_SUPER_ADMIN_NAME?.trim() || "Super Admin"
  ).slice(0, 80);

  if (requireAuth) {
    if (!superAdminEmail) {
      throw new Error(
        "LAYERS_SUPER_ADMIN_EMAIL is required. Copy .env.example to .env and set the super-admin credentials.",
      );
    }
    if (
      superAdminEmail.length > 254 ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(superAdminEmail)
    ) {
      throw new Error(
        "LAYERS_SUPER_ADMIN_EMAIL must be a valid email address.",
      );
    }
    if (!superAdminPassword) {
      throw new Error(
        "LAYERS_SUPER_ADMIN_PASSWORD is required. Copy .env.example to .env and set the super-admin credentials.",
      );
    }
    if (superAdminPassword.length < 12 || superAdminPassword.length > 200) {
      throw new Error(
        "LAYERS_SUPER_ADMIN_PASSWORD must be between 12 and 200 characters.",
      );
    }
  }

  const uiOrigins = new Set<string>([
    "http://127.0.0.1:5173",
    "http://localhost:5173",
  ]);
  const configuredOrigin = env.LAYERS_UI_ORIGIN;
  if (configuredOrigin) {
    uiOrigins.add(normalizeOrigin(configuredOrigin));
  }

  const rawPort = Number(env.PORT ?? "3001");
  const port = Number.isInteger(rawPort) && rawPort > 0 ? rawPort : 3001;
  const rawDbPath = env.LAYERS_DB_PATH ?? "data/layers.sqlite";
  const dbPath = rawDbPath === ":memory:" ? rawDbPath : path.resolve(rawDbPath);

  return {
    host,
    port,
    dbPath,
    seedSamples: env.LAYERS_SEED_SAMPLES !== "0",
    testMode,
    allowRemote,
    staticRoot: path.resolve("dist"),
    openapiPath: path.resolve("server/api/openapi.yaml"),
    superAdminEmail,
    superAdminPassword,
    superAdminName,
    sessionTtlDays: positiveInteger(env.LAYERS_SESSION_TTL_DAYS, 30),
    secureCookies: env.LAYERS_SECURE_COOKIES === "1",
    uiOrigins: Array.from(uiOrigins),
    loginRateLimit: positiveInteger(
      env.LAYERS_LOGIN_RATE_LIMIT,
      testMode ? 1000 : 5,
    ),
    loginRateWindowMinutes: positiveInteger(
      env.LAYERS_LOGIN_RATE_WINDOW_MINUTES,
      15,
    ),
  };
}
