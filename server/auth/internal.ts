import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { TokenScope } from "./types";

export const INTERNAL_AUTH_HEADER = "x-layers-internal-auth";
const CONTEXT_TTL_MS = 30_000;

export interface InternalAuthContext {
  userId: string;
  projectId: string;
  tokenId: string;
  scopes: TokenScope[];
}

export interface InternalAuth {
  headerName: string;
  sign(context: InternalAuthContext): string;
  verify(value: string): InternalAuthContext | null;
}

function isScope(value: unknown): value is TokenScope {
  return value === "read" || value === "write";
}

function parseContext(value: unknown): InternalAuthContext | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Record<string, unknown>;
  if (
    typeof candidate.userId !== "string" ||
    typeof candidate.projectId !== "string" ||
    typeof candidate.tokenId !== "string" ||
    typeof candidate.expiresAt !== "number" ||
    !Array.isArray(candidate.scopes)
  ) {
    return null;
  }
  if (candidate.expiresAt < Date.now()) return null;
  if (!candidate.scopes.every(isScope)) return null;
  return {
    userId: candidate.userId,
    projectId: candidate.projectId,
    tokenId: candidate.tokenId,
    scopes: candidate.scopes,
  };
}

export function createInternalAuth(
  secret: Buffer = randomBytes(32),
): InternalAuth {
  const signature = (payload: string) =>
    createHmac("sha256", secret).update(payload).digest("base64url");

  return {
    headerName: INTERNAL_AUTH_HEADER,
    sign(context) {
      const payload = Buffer.from(
        JSON.stringify({
          ...context,
          expiresAt: Date.now() + CONTEXT_TTL_MS,
        }),
        "utf8",
      ).toString("base64url");
      return `${payload}.${signature(payload)}`;
    },
    verify(value) {
      const [payload, provided] = value.split(".");
      if (!payload || !provided) return null;
      const expected = signature(payload);
      const providedBytes = Buffer.from(provided, "utf8");
      const expectedBytes = Buffer.from(expected, "utf8");
      if (
        providedBytes.length !== expectedBytes.length ||
        !timingSafeEqual(providedBytes, expectedBytes)
      ) {
        return null;
      }
      try {
        return parseContext(
          JSON.parse(Buffer.from(payload, "base64url").toString("utf8")),
        );
      } catch {
        return null;
      }
    },
  };
}
