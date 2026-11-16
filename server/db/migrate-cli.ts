import { loadConfig } from "../config";
import { openDatabase } from "./client";
import { runMigrations } from "./migrate";

const config = loadConfig(process.env, { requireAuth: false });
const db = openDatabase(config.dbPath);
runMigrations(db);
db.close();
console.log(`Migrations applied to ${config.dbPath}`);
