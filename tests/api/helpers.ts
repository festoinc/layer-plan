import path from "node:path";
import type { FastifyInstance, InjectOptions } from "fastify";
import { buildApp } from "../../server/app";
import type { ServerConfig } from "../../server/config";
import { openDatabase, type DatabaseConnection } from "../../server/db/client";
import { runMigrations } from "../../server/db/migrate";
import { SqliteStore } from "../../server/db/store";

export const FIXED_NOW = "2026-01-01T00:00:00.000Z";

function idFactory() {
  let counter = 0;
  return () => `id-${(counter += 1)}`;
}

export interface TestApi {
  app: FastifyInstance;
  store: SqliteStore;
  db: DatabaseConnection;
  close: () => Promise<void>;
}

export async function createTestApi(
  options: { seed?: boolean } = {},
): Promise<TestApi> {
  const db = openDatabase(":memory:");
  runMigrations(db);
  const store = new SqliteStore(db, {
    now: () => FIXED_NOW,
    newId: idFactory(),
  });
  if (options.seed !== false) store.seedSamples();

  const config: ServerConfig = {
    host: "127.0.0.1",
    port: 0,
    dbPath: ":memory:",
    seedSamples: options.seed !== false,
    testMode: true,
    allowRemote: false,
    staticRoot: path.resolve("test-results/does-not-exist"),
    openapiPath: path.resolve("server/api/openapi.yaml"),
  };
  const app = await buildApp({ config, store, logger: false });
  await app.ready();

  return {
    app,
    store,
    db,
    close: async () => {
      await app.close();
    },
  };
}

export function json(response: { payload: string }) {
  return JSON.parse(response.payload);
}

export function docRequest(body: object): InjectOptions {
  return {
    payload: body,
    headers: { "content-type": "application/json" },
  };
}
