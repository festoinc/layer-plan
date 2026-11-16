import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { DatabaseConnection } from "./client";

interface Migration {
  version: number;
  sql: string;
}

function readMigration(relative: string): string {
  const candidates = [
    fileURLToPath(new URL(relative, import.meta.url)),
    path.resolve(process.cwd(), "server/db", relative),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return fs.readFileSync(candidate, "utf8");
  }
  throw new Error(`Migration file not found: ${relative}`);
}

const MIGRATIONS: Migration[] = [
  {
    version: 1,
    sql: readMigration("migrations/001_init.sql"),
  },
  {
    version: 2,
    sql: readMigration("migrations/002_auth.sql"),
  },
  {
    version: 3,
    sql: readMigration("migrations/003_project_api_keys.sql"),
  },
];

export function runMigrations(db: DatabaseConnection): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      applied_at TEXT NOT NULL
    ) STRICT;
  `);

  const applied = new Set(
    db
      .prepare("SELECT version FROM schema_migrations")
      .all()
      .map((row) => Number((row as { version: number }).version)),
  );

  const apply = db.transaction((migration: Migration) => {
    db.exec(migration.sql);
    db.prepare(
      "INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)",
    ).run(migration.version, new Date().toISOString());
  });

  for (const migration of MIGRATIONS) {
    if (!applied.has(migration.version)) apply(migration);
  }
}
