export type UserRole = "super_admin" | "member";

export type TokenScope = "read" | "write";

export type OAuthClientAuthMethod =
  "none" | "client_secret_post" | "client_secret_basic";

export type OAuthClientSource = "dcr";

export interface UserRecord {
  id: string;
  email: string;
  displayName: string;
  passwordHash: string;
  role: UserRole;
  createdAt: string;
  updatedAt: string;
  disabledAt: string | null;
}

export interface SessionRecord {
  id: string;
  userId: string;
  tokenHash: string;
  createdAt: string;
  lastSeenAt: string;
  expiresAt: string;
  userAgent: string | null;
}

export interface ApiTokenRecord {
  id: string;
  userId: string;
  projectId: string;
  name: string;
  prefix: string;
  tokenHash: string;
  scopes: TokenScope[];
  createdAt: string;
  lastUsedAt: string | null;
  expiresAt: string | null;
  revokedAt: string | null;
}

export interface AuthUser {
  id: string;
  email: string;
  displayName: string;
  role: UserRole;
  createdAt: string;
  updatedAt: string;
  disabledAt: string | null;
}

export interface OAuthClientRecord {
  id: string;
  name: string;
  redirectUris: string[];
  grantTypes: string[];
  responseTypes: string[];
  tokenEndpointAuthMethod: OAuthClientAuthMethod;
  clientSecretHash: string | null;
  source: OAuthClientSource;
  createdAt: string;
  lastUsedAt: string | null;
}

export type OAuthAuthorizationRequestStatus = "pending" | "approved" | "denied";

export interface OAuthAuthorizationRequestRecord {
  id: string;
  clientId: string;
  redirectUri: string;
  scopes: TokenScope[];
  state: string | null;
  codeChallenge: string;
  codeChallengeMethod: "S256";
  resource: string;
  createdAt: string;
  expiresAt: string;
  status: OAuthAuthorizationRequestStatus;
  userId: string | null;
  projectId: string | null;
  decidedAt: string | null;
}

export interface OAuthAuthorizationCodeRecord {
  codeHash: string;
  clientId: string;
  userId: string;
  projectId: string;
  scopes: TokenScope[];
  redirectUri: string;
  codeChallenge: string;
  resource: string;
  createdAt: string;
  expiresAt: string;
  consumedAt: string | null;
}

export interface OAuthGrantRecord {
  id: string;
  clientId: string;
  clientName: string | null;
  userId: string;
  projectId: string;
  scopes: TokenScope[];
  resource: string;
  accessTokenHash: string;
  refreshTokenHash: string;
  previousRefreshTokenHash: string | null;
  accessExpiresAt: string;
  refreshExpiresAt: string;
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
}

export type AuthContext =
  | { method: "session"; user: AuthUser; sessionId: string }
  | {
      method: "token";
      credential: "api_key" | "oauth";
      user: AuthUser;
      tokenId: string;
      projectId: string;
      scopes: TokenScope[];
    };

export function publicUser(user: UserRecord | AuthUser): AuthUser {
  return {
    id: user.id,
    email: user.email,
    displayName: user.displayName,
    role: user.role,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
    disabledAt: user.disabledAt,
  };
}
