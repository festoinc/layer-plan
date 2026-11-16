import type {
  ApiTokenRecord,
  AuthUser,
  SessionRecord,
  UserRecord,
} from "../auth/types";
import { publicUser } from "../auth/types";

export function userJson(user: UserRecord | AuthUser): AuthUser {
  return publicUser(user);
}

export function sessionJson(
  session: SessionRecord,
  currentSessionId?: string,
): {
  id: string;
  createdAt: string;
  lastSeenAt: string;
  expiresAt: string;
  userAgent: string | null;
  current: boolean;
} {
  return {
    id: session.id,
    createdAt: session.createdAt,
    lastSeenAt: session.lastSeenAt,
    expiresAt: session.expiresAt,
    userAgent: session.userAgent,
    current:
      currentSessionId === undefined ? false : currentSessionId === session.id,
  };
}

export function loginSessionJson(session: SessionRecord): {
  id: string;
  createdAt: string;
  lastSeenAt: string;
  expiresAt: string;
  userAgent: string | null;
} {
  return {
    id: session.id,
    createdAt: session.createdAt,
    lastSeenAt: session.lastSeenAt,
    expiresAt: session.expiresAt,
    userAgent: session.userAgent,
  };
}

export function apiTokenJson(token: ApiTokenRecord): {
  id: string;
  projectId: string;
  name: string;
  prefix: string;
  scopes: string[];
  createdAt: string;
  lastUsedAt: string | null;
  expiresAt: string | null;
  revokedAt: string | null;
} {
  return {
    id: token.id,
    projectId: token.projectId,
    name: token.name,
    prefix: token.prefix,
    scopes: token.scopes,
    createdAt: token.createdAt,
    lastUsedAt: token.lastUsedAt,
    expiresAt: token.expiresAt,
    revokedAt: token.revokedAt,
  };
}
