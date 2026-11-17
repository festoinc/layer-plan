import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { loadConfig } from "../../server/config";
import {
  normalizeResource,
  parseScopeValue,
  redirectHost,
  redirectUriMatches,
  requestedScopes,
  validateRedirectUri,
} from "../../server/oauth/validation";
import { verifyPkce } from "../../server/oauth/crypto";

function oauthConfig() {
  return loadConfig(
    {
      LAYERS_PUBLIC_URL: "https://layers.example.com",
      LAYERS_DB_PATH: ":memory:",
    },
    { requireAuth: false },
  ).oauth!;
}

describe("OAuth validation", () => {
  it("accepts HTTPS, loopback HTTP and native-app redirect URIs", () => {
    expect(validateRedirectUri("https://client.example/callback")).toBeNull();
    expect(validateRedirectUri("http://127.0.0.1:4321/callback")).toBeNull();
    expect(validateRedirectUri("http://localhost:4321/callback")).toBeNull();
    expect(
      validateRedirectUri("cursor://anysphere.cursor/oauth/callback"),
    ).toBeNull();
    expect(validateRedirectUri("http://client.example/callback")).toMatch(
      /loopback/,
    );
    expect(validateRedirectUri("https://client.example/cb#fragment")).toMatch(
      /fragment/,
    );
    expect(validateRedirectUri("javascript:alert(1)")).toMatch(/not allowed/);
    expect(validateRedirectUri("not a url")).toMatch(/absolute/);
  });

  it("matches registered redirects exactly and allows loopback ports", () => {
    expect(
      redirectUriMatches(
        "https://client.example/callback",
        "https://client.example/callback",
      ),
    ).toBe(true);
    expect(
      redirectUriMatches(
        "https://client.example/other",
        "https://client.example/callback",
      ),
    ).toBe(false);
    expect(
      redirectUriMatches(
        "http://127.0.0.1:54321/callback",
        "http://127.0.0.1:12345/callback",
      ),
    ).toBe(true);
    expect(
      redirectUriMatches(
        "http://127.0.0.1:54321/callback?x=1",
        "http://127.0.0.1:12345/callback",
      ),
    ).toBe(false);
    expect(redirectHost("https://client.example/callback")).toBe(
      "client.example",
    );
    expect(redirectHost("http://127.0.0.1:54321/callback")).toBe(
      "127.0.0.1:54321",
    );
  });

  it("normalizes the MCP resource and scope names", () => {
    const oauth = oauthConfig();
    expect(normalizeResource(undefined, oauth)).toBe(
      "https://layers.example.com/mcp",
    );
    expect(normalizeResource("https://layers.example.com", oauth)).toBe(
      "https://layers.example.com/mcp",
    );
    expect(normalizeResource("https://layers.example.com/mcp/", oauth)).toBe(
      "https://layers.example.com/mcp",
    );
    expect(normalizeResource("HTTPS://LAYERS.EXAMPLE.COM/mcp", oauth)).toBe(
      "https://layers.example.com/mcp",
    );
    expect(normalizeResource("https://other.example/mcp", oauth)).toBeNull();
    expect(
      normalizeResource("https://layers.example.com/mcp?x=1", oauth),
    ).toBeNull();

    expect(requestedScopes(undefined)).toEqual(["read", "write"]);
    expect(requestedScopes("")).toEqual(["read", "write"]);
    expect(requestedScopes("read")).toEqual(["read"]);
    expect(requestedScopes("write")).toEqual(["read", "write"]);
    expect(requestedScopes("admin")).toBeNull();
    expect(parseScopeValue("read write")).toEqual(["read", "write"]);
    expect(parseScopeValue("")).toEqual([]);
  });

  it("verifies S256 PKCE and rejects plain or malformed verifiers", () => {
    const verifier = "a".repeat(64);
    const challenge = createHash("sha256").update(verifier).digest("base64url");
    expect(verifyPkce(verifier, challenge)).toBe(true);
    expect(verifyPkce("b".repeat(64), challenge)).toBe(false);
    expect(verifyPkce("short", challenge)).toBe(false);
  });
});

describe("OAuth config", () => {
  it("derives endpoints from LAYERS_PUBLIC_URL", () => {
    const config = loadConfig(
      {
        LAYERS_PUBLIC_URL: "https://layers.example.com/",
        LAYERS_DB_PATH: ":memory:",
      },
      { requireAuth: false },
    );
    expect(config.oauth).toMatchObject({
      issuer: "https://layers.example.com",
      resource: "https://layers.example.com/mcp",
      authorizeUrl: "https://layers.example.com/oauth/authorize",
      tokenUrl: "https://layers.example.com/oauth/token",
    });
  });

  it("allows loopback HTTP and rejects unsafe public URLs", () => {
    expect(
      loadConfig(
        {
          LAYERS_PUBLIC_URL: "http://127.0.0.1:3001",
          LAYERS_DB_PATH: ":memory:",
        },
        { requireAuth: false },
      ).oauth?.issuer,
    ).toBe("http://127.0.0.1:3001");
    expect(() =>
      loadConfig(
        {
          LAYERS_PUBLIC_URL: "http://layers.example.com",
          LAYERS_DB_PATH: ":memory:",
        },
        { requireAuth: false },
      ),
    ).toThrow(/https/);
    expect(() =>
      loadConfig(
        {
          LAYERS_PUBLIC_URL: "https://layers.example.com/app",
          LAYERS_DB_PATH: ":memory:",
        },
        { requireAuth: false },
      ),
    ).toThrow(/site root/);
  });
});
