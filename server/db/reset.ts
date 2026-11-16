import fs from "node:fs";
import { loadConfig } from "../config";
import { createPasswordHasher } from "../auth/password";
import { openDatabase } from "./client";
import { runMigrations } from "./migrate";
import { SqliteAuthStore } from "./authStore";
import { SqliteStore } from "./store";
import { bootstrap } from "./bootstrap";

const config = loadConfig();

if (config.dbPath !== ":memory:") {
  for (const suffix of ["", "-wal", "-shm"]) {
    try {
      fs.rmSync(`${config.dbPath}${suffix}`, { force: true });
    } catch {
      // Best effort; the migration below reports a real failure.
    }
  }
}

const db = openDatabase(config.dbPath);
runMigrations(db);
const store = new SqliteStore(db);
const authStore = new SqliteAuthStore(db);
const passwordHasher = createPasswordHasher({ testMode: config.testMode });
await bootstrap({ config, store, authStore, passwordHasher });
store.close();
console.log(`Reset and migrated ${config.dbPath}`);
