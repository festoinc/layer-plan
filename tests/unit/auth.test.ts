import { describe, expect, it } from "vitest";
import { createPasswordHasher } from "../../server/auth/password";
import {
  createApiTokenCredential,
  createSessionCredential,
  hashToken,
  normalizeScopes,
  tokenAllows,
} from "../../server/auth/tokens";
import { sessionExpiry } from "../../server/auth/middleware";
import {
  createTokenSchema,
  createUserSchema,
  loginSchema,
} from "../../server/api/schemas";

describe("password hashing", () => {
  it("hashes and verifies without storing the password", async () => {
    const hasher = createPasswordHasher({ testMode: true });
    const hash = await hasher.hash("correct horse battery staple");
    expect(hash).not.toContain("correct horse");
    expect(await hasher.verify(hash, "correct horse battery staple")).toBe(
      true,
    );
    expect(await hasher.verify(hash, "wrong password")).toBe(false);
  });

  it("verifies against a dummy hash without revealing unknown users", async () => {
    const hasher = createPasswordHasher({ testMode: true });
    expect(await hasher.verifyDummy("anything")).toBe(false);
  });
});

describe("tokens", () => {
  it("generates opaque session and API tokens with hashes", () => {
    const session = createSessionCredential();
    expect(session.id).toMatch(/^ses_/);
    expect(session.token.length).toBeGreaterThan(30);
    expect(session.tokenHash).toBe(hashToken(session.token));
    expect(session.tokenHash).not.toBe(session.token);

    const apiToken = createApiTokenCredential();
    expect(apiToken.id).toMatch(/^tok_/);
    expect(apiToken.token.startsWith("lrs_")).toBe(true);
    expect(apiToken.prefix).toBe(apiToken.token.slice(0, 12));
    expect(apiToken.tokenHash).toBe(hashToken(apiToken.token));
  });

  it("normalizes scopes and checks method access", () => {
    expect(normalizeScopes(["write"])).toEqual(["read", "write"]);
    expect(normalizeScopes(["read", "write"])).toEqual(["read", "write"]);
    expect(tokenAllows(["read"], "GET")).toBe(true);
    expect(tokenAllows(["read"], "HEAD")).toBe(true);
    expect(tokenAllows(["read"], "POST")).toBe(false);
    expect(tokenAllows(["read", "write"], "POST")).toBe(true);
  });

  it("computes session expiry from days", () => {
    expect(sessionExpiry("2026-01-01T00:00:00.000Z", 30)).toBe(
      "2026-01-31T00:00:00.000Z",
    );
  });
});

describe("auth request schemas", () => {
  it("validates login input", () => {
    expect(
      loginSchema.safeParse({ email: "a@b.co", password: "x" }).success,
    ).toBe(true);
    expect(
      loginSchema.safeParse({ email: "not-email", password: "x" }).success,
    ).toBe(false);
  });

  it("requires a 12-character user password", () => {
    expect(
      createUserSchema.safeParse({
        email: "ada@example.test",
        password: "short",
      }).success,
    ).toBe(false);
    expect(
      createUserSchema.safeParse({
        email: "ada@example.test",
        password: "twelve-characters",
      }).success,
    ).toBe(true);
  });

  it("validates token scopes", () => {
    expect(
      createTokenSchema.safeParse({ name: "agent", scopes: ["read"] }).success,
    ).toBe(true);
    expect(
      createTokenSchema.safeParse({ name: "agent", scopes: [] }).success,
    ).toBe(false);
    expect(
      createTokenSchema.safeParse({
        name: "agent",
        scopes: ["read", "read"],
      }).success,
    ).toBe(false);
  });
});
