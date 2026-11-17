import type { DatabaseConnection } from "./client";
import { createId } from "../../src/domain/projects";
import type {
  OAuthAuthorizationCodeRecord,
  OAuthAuthorizationRequestRecord,
  OAuthAuthorizationRequestStatus,
  OAuthClientAuthMethod,
  OAuthClientRecord,
  OAuthClientSource,
  OAuthGrantRecord,
  TokenScope,
} from "../auth/types";

interface OAuthClientRow {
  id: string;
  name: string;
  redirect_uris: string;
  grant_types: string;
  response_types: string;
  token_endpoint_auth_method: OAuthClientAuthMethod;
  client_secret_hash: string | null;
  source: OAuthClientSource;
  created_at: string;
  last_used_at: string | null;
}

interface OAuthAuthorizationRequestRow {
  id: string;
  client_id: string;
  redirect_uri: string;
  scopes: string;
  state: string | null;
  code_challenge: string;
  code_challenge_method: "S256";
  resource: string;
  created_at: string;
  expires_at: string;
  status: OAuthAuthorizationRequestStatus;
  user_id: string | null;
  project_id: string | null;
  decided_at: string | null;
}

interface OAuthAuthorizationCodeRow {
  code_hash: string;
  client_id: string;
  user_id: string;
  project_id: string;
  scopes: string;
  redirect_uri: string;
  code_challenge: string;
  resource: string;
  created_at: string;
  expires_at: string;
  consumed_at: string | null;
}

interface OAuthGrantRow {
  id: string;
  client_id: string;
  client_name?: string | null;
  user_id: string;
  project_id: string;
  scopes: string;
  resource: string;
  access_token_hash: string;
  refresh_token_hash: string;
  previous_refresh_token_hash: string | null;
  access_expires_at: string;
  refresh_expires_at: string;
  created_at: string;
  last_used_at: string | null;
  revoked_at: string | null;
}

export interface OAuthStoreOptions {
  now?: () => string;
  newId?: () => string;
}

export interface CreateOAuthClientInput {
  id?: string;
  name: string;
  redirectUris: string[];
  grantTypes: string[];
  responseTypes: string[];
  tokenEndpointAuthMethod: OAuthClientAuthMethod;
  clientSecretHash: string | null;
  source?: OAuthClientSource;
}

export interface CreateAuthorizationRequestInput {
  id?: string;
  clientId: string;
  redirectUri: string;
  scopes: TokenScope[];
  state: string | null;
  codeChallenge: string;
  codeChallengeMethod: "S256";
  resource: string;
  expiresAt: string;
}

export interface CreateAuthorizationCodeInput {
  codeHash: string;
  clientId: string;
  userId: string;
  projectId: string;
  scopes: TokenScope[];
  redirectUri: string;
  codeChallenge: string;
  resource: string;
  expiresAt: string;
}

export interface CreateOAuthGrantInput {
  id?: string;
  clientId: string;
  userId: string;
  projectId: string;
  scopes: TokenScope[];
  resource: string;
  accessTokenHash: string;
  refreshTokenHash: string;
  accessExpiresAt: string;
  refreshExpiresAt: string;
}

export interface RotateOAuthGrantInput {
  id: string;
  accessTokenHash: string;
  refreshTokenHash: string;
  previousRefreshTokenHash: string;
  accessExpiresAt: string;
  lastUsedAt: string;
}

export interface OAuthStore {
  createClient(input: CreateOAuthClientInput): OAuthClientRecord;
  getClient(id: string): OAuthClientRecord | null;
  countClients(): number;
  touchClient(id: string, lastUsedAt: string): void;
  pruneUnusedClients(cutoff: string): number;

  createAuthorizationRequest(
    input: CreateAuthorizationRequestInput,
  ): OAuthAuthorizationRequestRecord;
  getAuthorizationRequest(id: string): OAuthAuthorizationRequestRecord | null;
  approveAuthorizationRequest(
    id: string,
    userId: string,
    projectId: string,
    code: CreateAuthorizationCodeInput,
    now: string,
  ): boolean;
  denyAuthorizationRequest(id: string, userId: string, now: string): boolean;

  getAuthorizationCode(codeHash: string): OAuthAuthorizationCodeRecord | null;
  consumeAuthorizationCode(
    codeHash: string,
    now: string,
  ): OAuthAuthorizationCodeRecord | null;

  createGrant(input: CreateOAuthGrantInput): OAuthGrantRecord;
  createGrantForCode(
    codeHash: string,
    now: string,
    input: CreateOAuthGrantInput,
  ): OAuthGrantRecord | null;
  findGrantByAccessTokenHash(hash: string): OAuthGrantRecord | null;
  findGrantByRefreshTokenHash(hash: string): OAuthGrantRecord | null;
  findGrantByPreviousRefreshTokenHash(hash: string): OAuthGrantRecord | null;
  findGrantByAnyTokenHash(hash: string): OAuthGrantRecord | null;
  listGrants(userId: string, projectId: string): OAuthGrantRecord[];
  touchGrant(id: string, lastUsedAt: string): void;
  rotateGrant(input: RotateOAuthGrantInput): boolean;
  revokeGrant(id: string, now: string): boolean;
  revokeGrantForClient(
    clientId: string,
    tokenHash: string,
    now: string,
  ): boolean;
  revokeGrantForUser(
    userId: string,
    projectId: string,
    id: string,
    now: string,
  ): boolean;

  pruneAuthorizationArtifacts(now: string): number;
  resetOAuthData(): void;
}

function parseStringArray(value: string): string[] {
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === "string")
      : [];
  } catch {
    return [];
  }
}

function parseScopes(value: string): TokenScope[] {
  return parseStringArray(value).filter(
    (scope): scope is TokenScope => scope === "read" || scope === "write",
  );
}

function clientFromRow(row: OAuthClientRow): OAuthClientRecord {
  return {
    id: row.id,
    name: row.name,
    redirectUris: parseStringArray(row.redirect_uris),
    grantTypes: parseStringArray(row.grant_types),
    responseTypes: parseStringArray(row.response_types),
    tokenEndpointAuthMethod: row.token_endpoint_auth_method,
    clientSecretHash: row.client_secret_hash,
    source: row.source,
    createdAt: row.created_at,
    lastUsedAt: row.last_used_at,
  };
}

function requestFromRow(
  row: OAuthAuthorizationRequestRow,
): OAuthAuthorizationRequestRecord {
  return {
    id: row.id,
    clientId: row.client_id,
    redirectUri: row.redirect_uri,
    scopes: parseScopes(row.scopes),
    state: row.state,
    codeChallenge: row.code_challenge,
    codeChallengeMethod: row.code_challenge_method,
    resource: row.resource,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    status: row.status,
    userId: row.user_id,
    projectId: row.project_id,
    decidedAt: row.decided_at,
  };
}

function codeFromRow(
  row: OAuthAuthorizationCodeRow,
): OAuthAuthorizationCodeRecord {
  return {
    codeHash: row.code_hash,
    clientId: row.client_id,
    userId: row.user_id,
    projectId: row.project_id,
    scopes: parseScopes(row.scopes),
    redirectUri: row.redirect_uri,
    codeChallenge: row.code_challenge,
    resource: row.resource,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    consumedAt: row.consumed_at,
  };
}

function grantFromRow(row: OAuthGrantRow): OAuthGrantRecord {
  return {
    id: row.id,
    clientId: row.client_id,
    clientName: row.client_name ?? null,
    userId: row.user_id,
    projectId: row.project_id,
    scopes: parseScopes(row.scopes),
    resource: row.resource,
    accessTokenHash: row.access_token_hash,
    refreshTokenHash: row.refresh_token_hash,
    previousRefreshTokenHash: row.previous_refresh_token_hash,
    accessExpiresAt: row.access_expires_at,
    refreshExpiresAt: row.refresh_expires_at,
    createdAt: row.created_at,
    lastUsedAt: row.last_used_at,
    revokedAt: row.revoked_at,
  };
}

export class SqliteOAuthStore implements OAuthStore {
  private readonly db: DatabaseConnection;
  private readonly now: () => string;
  private readonly newId: () => string;

  constructor(db: DatabaseConnection, options: OAuthStoreOptions = {}) {
    this.db = db;
    this.now = options.now ?? (() => new Date().toISOString());
    this.newId = options.newId ?? createId;
  }

  createClient(input: CreateOAuthClientInput): OAuthClientRecord {
    const id = input.id ?? this.newId();
    this.db
      .prepare(
        `INSERT INTO oauth_clients (
          id, name, redirect_uris, grant_types, response_types,
          token_endpoint_auth_method, client_secret_hash, source,
          created_at, last_used_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
      )
      .run(
        id,
        input.name,
        JSON.stringify(input.redirectUris),
        JSON.stringify(input.grantTypes),
        JSON.stringify(input.responseTypes),
        input.tokenEndpointAuthMethod,
        input.clientSecretHash,
        input.source ?? "dcr",
        this.now(),
      );
    return this.requireClient(id);
  }

  getClient(id: string): OAuthClientRecord | null {
    const row = this.db
      .prepare("SELECT * FROM oauth_clients WHERE id = ?")
      .get(id) as OAuthClientRow | undefined;
    return row ? clientFromRow(row) : null;
  }

  countClients(): number {
    return (
      this.db.prepare("SELECT COUNT(*) AS count FROM oauth_clients").get() as {
        count: number;
      }
    ).count;
  }

  touchClient(id: string, lastUsedAt: string): void {
    this.db
      .prepare("UPDATE oauth_clients SET last_used_at = ? WHERE id = ?")
      .run(lastUsedAt, id);
  }

  pruneUnusedClients(cutoff: string): number {
    return this.db
      .prepare(
        `DELETE FROM oauth_clients
         WHERE created_at <= ?
           AND NOT EXISTS (
             SELECT 1 FROM oauth_grants
             WHERE oauth_grants.client_id = oauth_clients.id
           )`,
      )
      .run(cutoff).changes;
  }

  createAuthorizationRequest(
    input: CreateAuthorizationRequestInput,
  ): OAuthAuthorizationRequestRecord {
    const id = input.id ?? this.newId();
    this.db
      .prepare(
        `INSERT INTO oauth_authorization_requests (
          id, client_id, redirect_uri, scopes, state, code_challenge,
          code_challenge_method, resource, created_at, expires_at, status,
          user_id, project_id, decided_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', NULL, NULL, NULL)`,
      )
      .run(
        id,
        input.clientId,
        input.redirectUri,
        JSON.stringify(input.scopes),
        input.state,
        input.codeChallenge,
        input.codeChallengeMethod,
        input.resource,
        this.now(),
        input.expiresAt,
      );
    const row = this.db
      .prepare("SELECT * FROM oauth_authorization_requests WHERE id = ?")
      .get(id) as OAuthAuthorizationRequestRow;
    return requestFromRow(row);
  }

  getAuthorizationRequest(id: string): OAuthAuthorizationRequestRecord | null {
    const row = this.db
      .prepare("SELECT * FROM oauth_authorization_requests WHERE id = ?")
      .get(id) as OAuthAuthorizationRequestRow | undefined;
    return row ? requestFromRow(row) : null;
  }

  approveAuthorizationRequest(
    id: string,
    userId: string,
    projectId: string,
    code: CreateAuthorizationCodeInput,
    now: string,
  ): boolean {
    const transaction = this.db.transaction(() => {
      const updated = this.db
        .prepare(
          `UPDATE oauth_authorization_requests SET
            status = 'approved', user_id = ?, project_id = ?, decided_at = ?
           WHERE id = ? AND status = 'pending' AND expires_at > ?`,
        )
        .run(userId, projectId, now, id, now).changes;
      if (updated !== 1) return false;
      this.db
        .prepare(
          `INSERT INTO oauth_authorization_codes (
            code_hash, client_id, user_id, project_id, scopes, redirect_uri,
            code_challenge, resource, created_at, expires_at, consumed_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
        )
        .run(
          code.codeHash,
          code.clientId,
          code.userId,
          code.projectId,
          JSON.stringify(code.scopes),
          code.redirectUri,
          code.codeChallenge,
          code.resource,
          now,
          code.expiresAt,
        );
      return true;
    });
    return transaction();
  }

  denyAuthorizationRequest(id: string, userId: string, now: string): boolean {
    return (
      this.db
        .prepare(
          `UPDATE oauth_authorization_requests SET
            status = 'denied', user_id = ?, decided_at = ?
           WHERE id = ? AND status = 'pending' AND expires_at > ?`,
        )
        .run(userId, now, id, now).changes === 1
    );
  }

  getAuthorizationCode(codeHash: string): OAuthAuthorizationCodeRecord | null {
    const row = this.db
      .prepare("SELECT * FROM oauth_authorization_codes WHERE code_hash = ?")
      .get(codeHash) as OAuthAuthorizationCodeRow | undefined;
    return row ? codeFromRow(row) : null;
  }

  consumeAuthorizationCode(
    codeHash: string,
    now: string,
  ): OAuthAuthorizationCodeRecord | null {
    const row = this.getAuthorizationCode(codeHash);
    if (
      !row ||
      row.consumedAt ||
      Date.parse(row.expiresAt) <= Date.parse(now)
    ) {
      return null;
    }
    const changed = this.db
      .prepare(
        `UPDATE oauth_authorization_codes SET consumed_at = ?
         WHERE code_hash = ? AND consumed_at IS NULL`,
      )
      .run(now, codeHash).changes;
    return changed === 1 ? { ...row, consumedAt: now } : null;
  }

  createGrant(input: CreateOAuthGrantInput): OAuthGrantRecord {
    const id = input.id ?? this.newId();
    this.insertGrant(id, input, this.now());
    return this.requireGrant(id);
  }

  createGrantForCode(
    codeHash: string,
    now: string,
    input: CreateOAuthGrantInput,
  ): OAuthGrantRecord | null {
    const id = input.id ?? this.newId();
    const transaction = this.db.transaction(() => {
      const consumed = this.db
        .prepare(
          `UPDATE oauth_authorization_codes SET consumed_at = ?
           WHERE code_hash = ? AND consumed_at IS NULL AND expires_at > ?`,
        )
        .run(now, codeHash, now).changes;
      if (consumed !== 1) return null;
      this.insertGrant(id, input, now);
      return this.requireGrant(id);
    });
    return transaction();
  }

  findGrantByAccessTokenHash(hash: string): OAuthGrantRecord | null {
    return this.findGrant("access_token_hash", hash);
  }

  findGrantByRefreshTokenHash(hash: string): OAuthGrantRecord | null {
    return this.findGrant("refresh_token_hash", hash);
  }

  findGrantByPreviousRefreshTokenHash(hash: string): OAuthGrantRecord | null {
    return this.findGrant("previous_refresh_token_hash", hash);
  }

  findGrantByAnyTokenHash(hash: string): OAuthGrantRecord | null {
    const row = this.db
      .prepare(
        `SELECT * FROM oauth_grants
         WHERE access_token_hash = ?
            OR refresh_token_hash = ?
            OR previous_refresh_token_hash = ?
         LIMIT 1`,
      )
      .get(hash, hash, hash) as OAuthGrantRow | undefined;
    return row ? grantFromRow(row) : null;
  }

  listGrants(userId: string, projectId: string): OAuthGrantRecord[] {
    const rows = this.db
      .prepare(
        `SELECT grants.*, clients.name AS client_name
         FROM oauth_grants grants
         JOIN oauth_clients clients ON clients.id = grants.client_id
         WHERE grants.user_id = ? AND grants.project_id = ?
         ORDER BY grants.created_at DESC, grants.id DESC`,
      )
      .all(userId, projectId) as OAuthGrantRow[];
    return rows.map(grantFromRow);
  }

  touchGrant(id: string, lastUsedAt: string): void {
    this.db
      .prepare("UPDATE oauth_grants SET last_used_at = ? WHERE id = ?")
      .run(lastUsedAt, id);
  }

  rotateGrant(input: RotateOAuthGrantInput): boolean {
    return (
      this.db
        .prepare(
          `UPDATE oauth_grants SET
            access_token_hash = ?, refresh_token_hash = ?,
            previous_refresh_token_hash = ?, access_expires_at = ?,
            last_used_at = ?
           WHERE id = ? AND revoked_at IS NULL`,
        )
        .run(
          input.accessTokenHash,
          input.refreshTokenHash,
          input.previousRefreshTokenHash,
          input.accessExpiresAt,
          input.lastUsedAt,
          input.id,
        ).changes === 1
    );
  }

  revokeGrant(id: string, now: string): boolean {
    return (
      this.db
        .prepare(
          `UPDATE oauth_grants SET revoked_at = ?
           WHERE id = ? AND revoked_at IS NULL`,
        )
        .run(now, id).changes === 1
    );
  }

  revokeGrantForClient(
    clientId: string,
    tokenHash: string,
    now: string,
  ): boolean {
    const grant = this.findGrantByAnyTokenHash(tokenHash);
    if (!grant || grant.clientId !== clientId) return false;
    this.revokeGrant(grant.id, now);
    return true;
  }

  revokeGrantForUser(
    userId: string,
    projectId: string,
    id: string,
    now: string,
  ): boolean {
    return (
      this.db
        .prepare(
          `UPDATE oauth_grants SET revoked_at = ?
           WHERE id = ? AND user_id = ? AND project_id = ?
             AND revoked_at IS NULL`,
        )
        .run(now, id, userId, projectId).changes === 1
    );
  }

  pruneAuthorizationArtifacts(now: string): number {
    const cutoff = new Date(
      Date.parse(now) - 24 * 60 * 60 * 1000,
    ).toISOString();
    const codes = this.db
      .prepare("DELETE FROM oauth_authorization_codes WHERE expires_at <= ?")
      .run(cutoff).changes;
    const requests = this.db
      .prepare("DELETE FROM oauth_authorization_requests WHERE expires_at <= ?")
      .run(cutoff).changes;
    return codes + requests;
  }

  resetOAuthData(): void {
    const transaction = this.db.transaction(() => {
      this.db.exec(`
        DELETE FROM oauth_grants;
        DELETE FROM oauth_authorization_codes;
        DELETE FROM oauth_authorization_requests;
        DELETE FROM oauth_clients;
      `);
    });
    transaction();
  }

  private insertGrant(
    id: string,
    input: CreateOAuthGrantInput,
    createdAt: string,
  ): void {
    this.db
      .prepare(
        `INSERT INTO oauth_grants (
          id, client_id, user_id, project_id, scopes, resource,
          access_token_hash, refresh_token_hash, previous_refresh_token_hash,
          access_expires_at, refresh_expires_at, created_at, last_used_at,
          revoked_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, NULL, NULL)`,
      )
      .run(
        id,
        input.clientId,
        input.userId,
        input.projectId,
        JSON.stringify(input.scopes),
        input.resource,
        input.accessTokenHash,
        input.refreshTokenHash,
        input.accessExpiresAt,
        input.refreshExpiresAt,
        createdAt,
      );
  }

  private findGrant(
    column:
      | "access_token_hash"
      | "refresh_token_hash"
      | "previous_refresh_token_hash",
    hash: string,
  ): OAuthGrantRecord | null {
    const row = this.db
      .prepare(`SELECT * FROM oauth_grants WHERE ${column} = ?`)
      .get(hash) as OAuthGrantRow | undefined;
    return row ? grantFromRow(row) : null;
  }

  private requireClient(id: string): OAuthClientRecord {
    const client = this.getClient(id);
    if (!client) throw new Error(`OAuth client ${id} does not exist.`);
    return client;
  }

  private requireGrant(id: string): OAuthGrantRecord {
    const row = this.db
      .prepare("SELECT * FROM oauth_grants WHERE id = ?")
      .get(id) as OAuthGrantRow | undefined;
    if (!row) throw new Error(`OAuth grant ${id} does not exist.`);
    return grantFromRow(row);
  }
}
