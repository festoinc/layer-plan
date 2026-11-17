import type { OAuthConfig } from "../config";
import type { TokenScope } from "../auth/types";
import { normalizeScopes } from "../auth/tokens";

const MAX_REDIRECT_URI_LENGTH = 2048;
const MAX_STATE_LENGTH = 1024;
const MAX_RESOURCE_LENGTH = 2048;

export function isLoopbackHost(hostname: string): boolean {
  return (
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "[::1]" ||
    hostname === "::1"
  );
}

export function validateRedirectUri(value: string): string | null {
  if (!value || value.length > MAX_REDIRECT_URI_LENGTH) {
    return "The redirect URI is missing or too long.";
  }
  if (
    Array.from(value).some((character) => {
      const code = character.charCodeAt(0);
      return code < 0x20 || code === 0x7f;
    })
  ) {
    return "The redirect URI contains control characters.";
  }
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return "The redirect URI is not an absolute URI.";
  }
  if (url.username || url.password) {
    return "The redirect URI must not contain credentials.";
  }
  if (url.hash) {
    return "The redirect URI must not contain a fragment.";
  }
  if (url.protocol === "https:") return null;
  if (url.protocol === "http:") {
    return isLoopbackHost(url.hostname)
      ? null
      : "Plain HTTP redirect URIs are only allowed for loopback hosts.";
  }
  if (
    url.protocol === "javascript:" ||
    url.protocol === "data:" ||
    url.protocol === "file:" ||
    url.protocol === "vbscript:"
  ) {
    return "That redirect URI scheme is not allowed.";
  }
  if (!url.protocol.endsWith(":") || !url.pathname) {
    return "That redirect URI scheme is not allowed.";
  }
  return null;
}

export function redirectUriMatches(
  requested: string,
  registered: string,
): boolean {
  if (requested === registered) return true;
  let requestedUrl: URL;
  let registeredUrl: URL;
  try {
    requestedUrl = new URL(requested);
    registeredUrl = new URL(registered);
  } catch {
    return false;
  }
  if (
    requestedUrl.username ||
    requestedUrl.password ||
    requestedUrl.hash ||
    registeredUrl.username ||
    registeredUrl.password ||
    registeredUrl.hash
  ) {
    return false;
  }
  if (
    requestedUrl.protocol !== registeredUrl.protocol ||
    requestedUrl.hostname !== registeredUrl.hostname ||
    requestedUrl.pathname !== registeredUrl.pathname ||
    requestedUrl.search !== registeredUrl.search
  ) {
    return false;
  }
  return (
    registeredUrl.protocol === "http:" && isLoopbackHost(registeredUrl.hostname)
  );
}

export function redirectHost(value: string): string {
  try {
    const url = new URL(value);
    if (url.protocol === "http:" || url.protocol === "https:") {
      return url.host;
    }
    return url.protocol.replace(/:$/, "");
  } catch {
    return "unknown";
  }
}

export function parseScopeValue(
  value: string | null | undefined,
): TokenScope[] | null {
  const raw = value?.trim() ?? "";
  if (!raw) return [];
  const scopes = new Set<TokenScope>();
  for (const part of raw.split(/\s+/)) {
    if (part === "read" || part === "write") {
      scopes.add(part);
    } else {
      return null;
    }
  }
  return normalizeScopes(Array.from(scopes));
}

export function requestedScopes(
  value: string | null | undefined,
): TokenScope[] | null {
  const parsed = parseScopeValue(value);
  if (parsed === null) return null;
  return parsed.length ? parsed : ["read", "write"];
}

export function scopesAreSubset(
  granted: TokenScope[],
  requested: TokenScope[],
): boolean {
  const allowed = new Set(requested);
  return granted.every((scope) => allowed.has(scope));
}

export function sameScopes(left: TokenScope[], right: TokenScope[]): boolean {
  const normalizedLeft = normalizeScopes(left);
  const normalizedRight = normalizeScopes(right);
  return (
    normalizedLeft.length === normalizedRight.length &&
    normalizedLeft.every((scope, index) => scope === normalizedRight[index])
  );
}

export function normalizeResource(
  value: string | null | undefined,
  oauth: OAuthConfig,
): string | null {
  const raw = value?.trim();
  if (!raw) return oauth.resource;
  if (raw.length > MAX_RESOURCE_LENGTH) return null;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.username || url.password || url.search || url.hash) return null;
  const normalized = `${url.protocol}//${url.host}${url.pathname}`.replace(
    /\/+$/,
    "",
  );
  if (normalized === oauth.issuer || normalized === oauth.resource) {
    return oauth.resource;
  }
  return null;
}

export function validState(value: string | null | undefined): boolean {
  return !value || value.length <= MAX_STATE_LENGTH;
}

export function withRedirectParams(
  redirectUri: string,
  params: Record<string, string | null>,
): string {
  const url = new URL(redirectUri);
  for (const [key, value] of Object.entries(params)) {
    if (value !== null) url.searchParams.set(key, value);
  }
  return url.toString();
}
