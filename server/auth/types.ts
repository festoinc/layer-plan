export type UserRole = "super_admin" | "member";

export type TokenScope = "read" | "write";

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

export type AuthContext =
  | { method: "session"; user: AuthUser; sessionId: string }
  | {
      method: "token";
      user: AuthUser;
      tokenId: string;
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
