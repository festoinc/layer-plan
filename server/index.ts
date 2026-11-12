import { buildApp } from "./app";
import { loadConfig } from "./config";
import { openDatabase } from "./db/client";
import { runMigrations } from "./db/migrate";
import { SqliteStore } from "./db/store";

const config = loadConfig();
const db = openDatabase(config.dbPath);
runMigrations(db);
const store = new SqliteStore(db);
if (config.seedSamples) store.seedSamples();

const app = await buildApp({ config, store });

async function shutdown(signal: string) {
  app.log.info({ signal }, "Shutting down");
  try {
    await app.close();
  } finally {
    process.exit(0);
  }
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));

try {
  await app.listen({ host: config.host, port: config.port });
  app.log.info(
    `Layers API listening on http://${config.host}:${config.port}/api/v1`,
  );
} catch (error) {
  app.log.error(error);
  store.close();
  process.exit(1);
}
