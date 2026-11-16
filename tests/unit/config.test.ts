import { describe, expect, it } from "vitest";
import { loadConfig } from "../../server/config";

describe("server config", () => {
  it("supplies test-mode super-admin defaults", () => {
    const config = loadConfig(
      { LAYERS_TEST_MODE: "1", LAYERS_DB_PATH: ":memory:" },
      { requireAuth: true },
    );
    expect(config.superAdminEmail).toBe("super@example.test");
    expect(config.superAdminPassword).toBe("test-super-admin-password");
    expect(config.loginRateLimit).toBe(1000);
  });

  it("requires valid super-admin credentials outside test mode", () => {
    expect(() =>
      loadConfig({ LAYERS_DB_PATH: ":memory:" }, { requireAuth: true }),
    ).toThrow(/LAYERS_SUPER_ADMIN_EMAIL/);

    expect(() =>
      loadConfig(
        {
          LAYERS_SUPER_ADMIN_EMAIL: "not-an-email",
          LAYERS_SUPER_ADMIN_PASSWORD: "a-long-enough-password",
          LAYERS_DB_PATH: ":memory:",
        },
        { requireAuth: true },
      ),
    ).toThrow(/valid email/);

    expect(() =>
      loadConfig(
        {
          LAYERS_SUPER_ADMIN_EMAIL: "admin@example.test",
          LAYERS_SUPER_ADMIN_PASSWORD: "short",
          LAYERS_DB_PATH: ":memory:",
        },
        { requireAuth: true },
      ),
    ).toThrow(/between 12 and 200/);
  });

  it("allows auth-free config loading for migrations", () => {
    const config = loadConfig(
      { LAYERS_DB_PATH: ":memory:" },
      { requireAuth: false },
    );
    expect(config.dbPath).toBe(":memory:");
    expect(config.superAdminEmail).toBe("");
  });
});
