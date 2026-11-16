import { createHash, randomBytes } from "node:crypto";
import type { TokenScope } from "./types";

export function randomId(prefix: string, bytes = 12): string {
  return `${prefix}${randomBytes(bytes).toString("base64url")}`;
}

export const MAX_ACTIVE_API_TOKENS = 20;
export const DEFAULT_API_TOKEN_EXPIRY_DAYS = 3650;
export const MAX_API_TOKEN_EXPIRY_DAYS = 3650;

export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export function createSessionCredential(): {
  id: string;
  token: string;
  tokenHash: string;
} {
  const token = randomToken();
  return {
    id: randomId("ses_"),
    token,
    tokenHash: hashToken(token),
  };
}

export function createApiTokenCredential(): {
  id: string;
  token: string;
  tokenHash: string;
  prefix: string;
} {
  const token = `lrs_${randomToken()}`;
  return {
    id: randomId("tok_"),
    token,
    tokenHash: hashToken(token),
    prefix: token.slice(0, 12),
  };
}

export function normalizeScopes(scopes: TokenScope[]): TokenScope[] {
  const unique = new Set(scopes);
  if (unique.has("write")) unique.add("read");
  return Array.from(unique).sort();
}

export function tokenAllows(scopes: TokenScope[], method: string): boolean {
  if (method === "GET" || method === "HEAD") return scopes.includes("read");
  return scopes.includes("write");
}
