import { buildApp } from "./app";
import { loadConfig } from "./config";
import { createPasswordHasher } from "./auth/password";
import { openDatabase } from "./db/client";
import { runMigrations } from "./db/migrate";
import { SqliteAuthStore } from "./db/authStore";
import { SqliteStore } from "./db/store";
import { bootstrap } from "./db/bootstrap";

const config = loadConfig();
const db = openDatabase(config.dbPath);
runMigrations(db);
const store = new SqliteStore(db);
const authStore = new SqliteAuthStore(db);
const passwordHasher = createPasswordHasher({ testMode: config.testMode });
await bootstrap({ config, store, authStore, passwordHasher });

const app = await buildApp({ config, store, authStore, passwordHasher });

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
