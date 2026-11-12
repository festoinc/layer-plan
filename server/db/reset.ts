import fs from "node:fs";
import { loadConfig } from "../config";
import { openDatabase } from "./client";
import { runMigrations } from "./migrate";
import { SqliteStore } from "./store";

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
if (config.seedSamples) store.seedSamples();
store.close();
console.log(`Reset and migrated ${config.dbPath}`);
