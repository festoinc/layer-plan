import type { OAuthClientRecord } from "../auth/types";
import { verifyClientSecret } from "./crypto";
import { OAuthProtocolError } from "./errors";

type FormBody = Record<string, unknown>;

function invalidClient(hasBasic: boolean): OAuthProtocolError {
  return new OAuthProtocolError(
    401,
    "invalid_client",
    "Client authentication failed.",
    hasBasic ? { "WWW-Authenticate": 'Basic realm="Layers"' } : undefined,
  );
}

export function hasBasicHeader(header: string | undefined): boolean {
  return /^Basic\s+/i.test(header ?? "");
}

export function parseBasicCredentials(
  header: string | undefined,
): { clientId: string; secret: string } | null {
  const match = /^Basic\s+(.+)$/i.exec((header ?? "").trim());
  if (!match) return null;
  let decoded: string;
  try {
    decoded = Buffer.from(match[1] ?? "", "base64").toString("utf8");
  } catch {
    return null;
  }
  const separator = decoded.indexOf(":");
  if (separator < 0) return null;
  const decode = (value: string): string | null => {
    try {
      return decodeURIComponent(value.replace(/\+/g, " "));
    } catch {
      return null;
    }
  };
  const clientId = decode(decoded.slice(0, separator));
  const secret = decode(decoded.slice(separator + 1));
  if (!clientId || secret === null) return null;
  return { clientId, secret };
}

export function requestedClientId(
  header: string | undefined,
  body: FormBody,
): string | null {
  const basic = parseBasicCredentials(header);
  if (basic) return basic.clientId;
  const value = body.client_id;
  return typeof value === "string" && value ? value : null;
}

export function authenticateClient(
  client: OAuthClientRecord,
  header: string | undefined,
  body: FormBody,
): void {
  const basicHeader = hasBasicHeader(header);
  const basic = parseBasicCredentials(header);
  const bodyClientId =
    typeof body.client_id === "string" ? body.client_id : null;
  const bodySecret =
    typeof body.client_secret === "string" && body.client_secret
      ? body.client_secret
      : null;

  if (bodyClientId && bodyClientId !== client.id) {
    throw invalidClient(basicHeader);
  }

  if (basicHeader) {
    if (!basic || basic.clientId !== client.id) {
      throw invalidClient(true);
    }
    if (
      client.tokenEndpointAuthMethod !== "client_secret_basic" ||
      !client.clientSecretHash ||
      !verifyClientSecret(basic.secret, client.clientSecretHash)
    ) {
      throw invalidClient(true);
    }
    if (bodySecret !== null) {
      throw invalidClient(true);
    }
    return;
  }

  if (bodySecret !== null) {
    if (
      client.tokenEndpointAuthMethod !== "client_secret_post" ||
      !client.clientSecretHash ||
      !verifyClientSecret(bodySecret, client.clientSecretHash)
    ) {
      throw invalidClient(false);
    }
    return;
  }

  if (client.tokenEndpointAuthMethod !== "none") {
    throw invalidClient(false);
  }
}
