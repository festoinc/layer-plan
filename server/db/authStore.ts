import type { DatabaseConnection } from "./client";
import { createId } from "../../src/domain/projects";
import type {
  ApiTokenRecord,
  SessionRecord,
  TokenScope,
  UserRecord,
  UserRole,
} from "../auth/types";
import { normalizeScopes } from "../auth/tokens";

interface UserRow {
  id: string;
  email: string;
  display_name: string;
  password_hash: string;
  role: UserRole;
  created_at: string;
  updated_at: string;
  disabled_at: string | null;
}

interface SessionRow {
  id: string;
  user_id: string;
  token_hash: string;
  created_at: string;
  last_seen_at: string;
  expires_at: string;
  user_agent: string | null;
}

interface ApiTokenRow {
  id: string;
  user_id: string;
  name: string;
  prefix: string;
  token_hash: string;
  scopes: string;
  created_at: string;
  last_used_at: string | null;
  expires_at: string | null;
  revoked_at: string | null;
}

export interface AuthStoreOptions {
  now?: () => string;
  newId?: () => string;
}

export interface CreateUserInput {
  email: string;
  displayName: string;
  passwordHash: string;
}

export type UpdateSuperAdminInput = CreateUserInput;

export interface CreateSessionInput {
  id?: string;
  userId: string;
  tokenHash: string;
  expiresAt: string;
  userAgent: string | null;
}

export interface CreateApiTokenInput {
  id?: string;
  userId: string;
  name: string;
  prefix: string;
  tokenHash: string;
  scopes: TokenScope[];
  expiresAt: string | null;
}

export interface AuthStore {
  getSuperAdmin(): UserRecord | null;
  createSuperAdmin(input: CreateUserInput): UserRecord;
  updateSuperAdmin(id: string, input: UpdateSuperAdminInput): UserRecord;
  getUser(id: string): UserRecord | null;
  getUserByEmail(email: string): UserRecord | null;
  listUsers(): UserRecord[];
  createUser(input: CreateUserInput): UserRecord;
  setUserDisabled(id: string, disabled: boolean): UserRecord;

  createSession(input: CreateSessionInput): SessionRecord;
  getSession(id: string): SessionRecord | null;
  findSessionByTokenHash(tokenHash: string): SessionRecord | null;
  listSessions(userId: string): SessionRecord[];
  touchSession(id: string, lastSeenAt: string, expiresAt: string): void;
  deleteSession(id: string): void;
  deleteUserSessions(userId: string): void;
  deleteOtherSessions(userId: string, keepSessionId: string): void;
  pruneExpiredSessions(now: string): number;

  createApiToken(input: CreateApiTokenInput): ApiTokenRecord;
  findApiTokenByHash(tokenHash: string): ApiTokenRecord | null;
  listApiTokens(userId: string): ApiTokenRecord[];
  touchApiToken(id: string, lastUsedAt: string): void;
  revokeApiToken(userId: string, id: string): boolean;
  countApiTokens(userId: string): number;
  pruneExpiredApiTokens(now: string): number;

  resetAuthData(): void;
}

function userFromRow(row: UserRow): UserRecord {
  return {
    id: row.id,
    email: row.email,
    displayName: row.display_name,
    passwordHash: row.password_hash,
    role: row.role,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    disabledAt: row.disabled_at,
  };
}

function sessionFromRow(row: SessionRow): SessionRecord {
  return {
    id: row.id,
    userId: row.user_id,
    tokenHash: row.token_hash,
    createdAt: row.created_at,
    lastSeenAt: row.last_seen_at,
    expiresAt: row.expires_at,
    userAgent: row.user_agent,
  };
}

function parseScopes(value: string): TokenScope[] {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (scope): scope is TokenScope => scope === "read" || scope === "write",
    );
  } catch {
    return [];
  }
}

function apiTokenFromRow(row: ApiTokenRow): ApiTokenRecord {
  return {
    id: row.id,
    userId: row.user_id,
    name: row.name,
    prefix: row.prefix,
    tokenHash: row.token_hash,
    scopes: parseScopes(row.scopes),
    createdAt: row.created_at,
    lastUsedAt: row.last_used_at,
    expiresAt: row.expires_at,
    revokedAt: row.revoked_at,
  };
}

export class SqliteAuthStore implements AuthStore {
  private readonly db: DatabaseConnection;
  private readonly now: () => string;
  private readonly newId: () => string;

  constructor(db: DatabaseConnection, options: AuthStoreOptions = {}) {
    this.db = db;
    this.now = options.now ?? (() => new Date().toISOString());
    this.newId = options.newId ?? createId;
  }

  getSuperAdmin(): UserRecord | null {
    const row = this.db
      .prepare("SELECT * FROM users WHERE role = 'super_admin' LIMIT 1")
      .get() as UserRow | undefined;
    return row ? userFromRow(row) : null;
  }

  createSuperAdmin(input: CreateUserInput): UserRecord {
    const id = this.newId();
    const timestamp = this.now();
    this.db
      .prepare(
        `INSERT INTO users (
          id, email, display_name, password_hash, role,
          created_at, updated_at, disabled_at
        ) VALUES (?, ?, ?, ?, 'super_admin', ?, ?, NULL)`,
      )
      .run(
        id,
        input.email,
        input.displayName,
        input.passwordHash,
        timestamp,
        timestamp,
      );
    return this.requireUser(id);
  }

  updateSuperAdmin(id: string, input: UpdateSuperAdminInput): UserRecord {
    this.db
      .prepare(
        `UPDATE users SET
          email = ?, display_name = ?, password_hash = ?,
          role = 'super_admin', disabled_at = NULL, updated_at = ?
         WHERE id = ?`,
      )
      .run(input.email, input.displayName, input.passwordHash, this.now(), id);
    return this.requireUser(id);
  }

  getUser(id: string): UserRecord | null {
    const row = this.db.prepare("SELECT * FROM users WHERE id = ?").get(id) as
      UserRow | undefined;
    return row ? userFromRow(row) : null;
  }

  getUserByEmail(email: string): UserRecord | null {
    const row = this.db
      .prepare("SELECT * FROM users WHERE email = ? COLLATE NOCASE")
      .get(email) as UserRow | undefined;
    return row ? userFromRow(row) : null;
  }

  listUsers(): UserRecord[] {
    const rows = this.db
      .prepare("SELECT * FROM users ORDER BY created_at ASC, email ASC")
      .all() as UserRow[];
    return rows.map(userFromRow);
  }

  createUser(input: CreateUserInput): UserRecord {
    const id = this.newId();
    const timestamp = this.now();
    this.db
      .prepare(
        `INSERT INTO users (
          id, email, display_name, password_hash, role,
          created_at, updated_at, disabled_at
        ) VALUES (?, ?, ?, ?, 'member', ?, ?, NULL)`,
      )
      .run(
        id,
        input.email,
        input.displayName,
        input.passwordHash,
        timestamp,
        timestamp,
      );
    return this.requireUser(id);
  }

  setUserDisabled(id: string, disabled: boolean): UserRecord {
    const timestamp = this.now();
    this.db
      .prepare("UPDATE users SET disabled_at = ?, updated_at = ? WHERE id = ?")
      .run(disabled ? timestamp : null, timestamp, id);
    if (disabled) this.deleteUserSessions(id);
    return this.requireUser(id);
  }

  createSession(input: CreateSessionInput): SessionRecord {
    const id = input.id ?? this.newId();
    const timestamp = this.now();
    this.db
      .prepare(
        `INSERT INTO sessions (
          id, user_id, token_hash, created_at, last_seen_at, expires_at,
          user_agent
        ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        input.userId,
        input.tokenHash,
        timestamp,
        timestamp,
        input.expiresAt,
        input.userAgent,
      );
    const row = this.db
      .prepare("SELECT * FROM sessions WHERE id = ?")
      .get(id) as SessionRow;
    return sessionFromRow(row);
  }

  getSession(id: string): SessionRecord | null {
    const row = this.db
      .prepare("SELECT * FROM sessions WHERE id = ?")
      .get(id) as SessionRow | undefined;
    return row ? sessionFromRow(row) : null;
  }

  findSessionByTokenHash(tokenHash: string): SessionRecord | null {
    const row = this.db
      .prepare("SELECT * FROM sessions WHERE token_hash = ?")
      .get(tokenHash) as SessionRow | undefined;
    return row ? sessionFromRow(row) : null;
  }

  listSessions(userId: string): SessionRecord[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM sessions
         WHERE user_id = ?
         ORDER BY created_at DESC, id DESC`,
      )
      .all(userId) as SessionRow[];
    return rows.map(sessionFromRow);
  }

  touchSession(id: string, lastSeenAt: string, expiresAt: string): void {
    this.db
      .prepare(
        "UPDATE sessions SET last_seen_at = ?, expires_at = ? WHERE id = ?",
      )
      .run(lastSeenAt, expiresAt, id);
  }

  deleteSession(id: string): void {
    this.db.prepare("DELETE FROM sessions WHERE id = ?").run(id);
  }

  deleteUserSessions(userId: string): void {
    this.db.prepare("DELETE FROM sessions WHERE user_id = ?").run(userId);
  }

  deleteOtherSessions(userId: string, keepSessionId: string): void {
    this.db
      .prepare("DELETE FROM sessions WHERE user_id = ? AND id <> ?")
      .run(userId, keepSessionId);
  }

  pruneExpiredSessions(now: string): number {
    return this.db
      .prepare("DELETE FROM sessions WHERE expires_at <= ?")
      .run(now).changes;
  }

  createApiToken(input: CreateApiTokenInput): ApiTokenRecord {
    const id = input.id ?? this.newId();
    const timestamp = this.now();
    this.db
      .prepare(
        `INSERT INTO api_tokens (
          id, user_id, name, prefix, token_hash, scopes,
          created_at, last_used_at, expires_at, revoked_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, NULL)`,
      )
      .run(
        id,
        input.userId,
        input.name,
        input.prefix,
        input.tokenHash,
        JSON.stringify(normalizeScopes(input.scopes)),
        timestamp,
        input.expiresAt,
      );
    const row = this.db
      .prepare("SELECT * FROM api_tokens WHERE id = ?")
      .get(id) as ApiTokenRow;
    return apiTokenFromRow(row);
  }

  findApiTokenByHash(tokenHash: string): ApiTokenRecord | null {
    const row = this.db
      .prepare("SELECT * FROM api_tokens WHERE token_hash = ?")
      .get(tokenHash) as ApiTokenRow | undefined;
    return row ? apiTokenFromRow(row) : null;
  }

  listApiTokens(userId: string): ApiTokenRecord[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM api_tokens
         WHERE user_id = ?
         ORDER BY created_at DESC, id DESC`,
      )
      .all(userId) as ApiTokenRow[];
    return rows.map(apiTokenFromRow);
  }

  touchApiToken(id: string, lastUsedAt: string): void {
    this.db
      .prepare("UPDATE api_tokens SET last_used_at = ? WHERE id = ?")
      .run(lastUsedAt, id);
  }

  revokeApiToken(userId: string, id: string): boolean {
    return (
      this.db
        .prepare(
          `UPDATE api_tokens SET revoked_at = ?
           WHERE id = ? AND user_id = ? AND revoked_at IS NULL`,
        )
        .run(this.now(), id, userId).changes > 0
    );
  }

  countApiTokens(userId: string): number {
    return (
      this.db
        .prepare(
          `SELECT COUNT(*) AS count FROM api_tokens
           WHERE user_id = ? AND revoked_at IS NULL`,
        )
        .get(userId) as { count: number }
    ).count;
  }

  pruneExpiredApiTokens(now: string): number {
    return this.db
      .prepare(
        `DELETE FROM api_tokens
         WHERE expires_at IS NOT NULL AND expires_at <= ?`,
      )
      .run(now).changes;
  }

  resetAuthData(): void {
    const transaction = this.db.transaction(() => {
      this.db.exec(`
        DELETE FROM sessions;
        DELETE FROM api_tokens;
        DELETE FROM user_state;
        DELETE FROM users;
      `);
    });
    transaction();
  }

  private requireUser(id: string): UserRecord {
    const user = this.getUser(id);
    if (!user) throw new Error(`User ${id} does not exist.`);
    return user;
  }
}
