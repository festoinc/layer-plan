import path from "node:path";

export interface ServerConfig {
  host: string;
  port: number;
  dbPath: string;
  seedSamples: boolean;
  testMode: boolean;
  allowRemote: boolean;
  staticRoot: string;
  openapiPath: string;
}

function isLoopback(host: string): boolean {
  return (
    host === "127.0.0.1" ||
    host === "localhost" ||
    host === "::1" ||
    host === "[::1]"
  );
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  const host = env.HOST ?? "127.0.0.1";
  const allowRemote = env.LAYERS_ALLOW_REMOTE === "1";
  if (!isLoopback(host) && !allowRemote) {
    throw new Error(
      `Refusing to bind to ${host}. Set LAYERS_ALLOW_REMOTE=1 only if you understand that this API has no authentication.`,
    );
  }

  const rawPort = Number(env.PORT ?? "3001");
  const port = Number.isInteger(rawPort) && rawPort > 0 ? rawPort : 3001;
  const dbPath = path.resolve(env.LAYERS_DB_PATH ?? "data/layers.sqlite");

  return {
    host,
    port,
    dbPath,
    seedSamples: env.LAYERS_SEED_SAMPLES !== "0",
    testMode: env.LAYERS_TEST_MODE === "1",
    allowRemote,
    staticRoot: path.resolve("dist"),
    openapiPath: path.resolve("server/api/openapi.yaml"),
  };
}
