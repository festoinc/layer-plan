import { createHash, timingSafeEqual } from "node:crypto";
import { hashToken, randomToken } from "../auth/tokens";

export const OAUTH_ACCESS_PREFIX = "loa_";
export const OAUTH_REFRESH_PREFIX = "lor_";
export const OAUTH_CODE_PREFIX = "loc_";
export const OAUTH_CLIENT_PREFIX = "lcl_";
export const OAUTH_SECRET_PREFIX = "lcs_";
export const OAUTH_GRANT_PREFIX = "org_";
export const OAUTH_REQUEST_PREFIX = "orq_";

export function newRequestId(): string {
  return `${OAUTH_REQUEST_PREFIX}${randomToken(16)}`;
}

export function newGrantId(): string {
  return `${OAUTH_GRANT_PREFIX}${randomToken(12)}`;
}

export function newClientCredentials(issueSecret: boolean): {
  id: string;
  secret: string | null;
  secretHash: string | null;
} {
  const id = `${OAUTH_CLIENT_PREFIX}${randomToken(16)}`;
  if (!issueSecret) return { id, secret: null, secretHash: null };
  const secret = `${OAUTH_SECRET_PREFIX}${randomToken(32)}`;
  return { id, secret, secretHash: hashToken(secret) };
}

export function newAuthorizationCode(): {
  code: string;
  codeHash: string;
} {
  const code = `${OAUTH_CODE_PREFIX}${randomToken(32)}`;
  return { code, codeHash: hashToken(code) };
}

export function newOAuthTokens(): {
  accessToken: string;
  accessTokenHash: string;
  refreshToken: string;
  refreshTokenHash: string;
} {
  const accessToken = `${OAUTH_ACCESS_PREFIX}${randomToken(32)}`;
  const refreshToken = `${OAUTH_REFRESH_PREFIX}${randomToken(32)}`;
  return {
    accessToken,
    accessTokenHash: hashToken(accessToken),
    refreshToken,
    refreshTokenHash: hashToken(refreshToken),
  };
}

export function constantTimeEqual(left: string, right: string): boolean {
  const leftBytes = Buffer.from(left, "utf8");
  const rightBytes = Buffer.from(right, "utf8");
  return (
    leftBytes.length === rightBytes.length &&
    timingSafeEqual(leftBytes, rightBytes)
  );
}

export function verifyClientSecret(
  secret: string,
  expectedHash: string,
): boolean {
  return constantTimeEqual(hashToken(secret), expectedHash);
}

export function verifyPkce(verifier: string, challenge: string): boolean {
  if (!/^[A-Za-z0-9\-._~]{43,128}$/.test(verifier)) return false;
  if (!/^[A-Za-z0-9_-]{43,128}$/.test(challenge)) return false;
  const digest = createHash("sha256")
    .update(verifier, "utf8")
    .digest("base64url");
  return constantTimeEqual(digest, challenge);
}
