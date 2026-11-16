import { afterEach, describe, expect, it } from "vitest";
import { createPasswordHasher } from "../../server/auth/password";
import { bootstrap } from "../../server/db/bootstrap";
import {
  authHeaders,
  createTestApi,
  json,
  TEST_SUPER_ADMIN,
  type TestApi,
} from "./helpers";

let api: TestApi | null = null;
afterEach(async () => {
  await api?.close();
  api = null;
});

async function superCookie(testApi: TestApi): Promise<string> {
  return (
    await testApi.login(TEST_SUPER_ADMIN.email, TEST_SUPER_ADMIN.password)
  ).cookie;
}

describe("auth migration and ownership bootstrap", () => {
  it("seeds samples owned by the super admin and sets an active project", async () => {
    api = await createTestApi();
    const superAdmin = api.authStore.getSuperAdmin();
    expect(superAdmin).toBeTruthy();
    const rows = api.db
      .prepare("SELECT id, owner_id FROM projects ORDER BY id")
      .all() as Array<{ id: string; owner_id: string }>;
    expect(rows).toHaveLength(2);
    expect(rows.every((row) => row.owner_id === superAdmin?.id)).toBe(true);
    expect(api.store.getUserState(superAdmin!.id).activeProjectId).toBe(
      "website",
    );
  });

  it("skips seeding when configured off", async () => {
    api = await createTestApi({ seed: false });
    const cookie = await superCookie(api);
    const response = await api.app.inject({
      method: "GET",
      url: "/api/v1/projects",
      headers: authHeaders(cookie),
    });
    expect(json(response).projects).toEqual([]);
    expect(json(response).activeProjectId).toBeNull();
  });

  it("claims a legacy project, attributes its activity and moves the active project", async () => {
    api = await createTestApi({ seed: false });
    const superAdmin = api.authStore.getSuperAdmin()!;
    api.db
      .prepare(
        `INSERT INTO projects (
          id, owner_id, name, initials, color, description, test_guidelines,
          chapter_count, criterion_count, checked_count,
          metadata_revision, created_at, updated_at
        ) VALUES (?, NULL, ?, ?, ?, ?, ?, 1, 0, 0, 1, ?, ?)`,
      )
      .run(
        "legacy",
        "Legacy project",
        "L",
        "indigo",
        "",
        "",
        "2025-01-01T00:00:00.000Z",
        "2025-01-01T00:00:00.000Z",
      );
    api.db
      .prepare(
        `INSERT INTO project_documents
          (project_id, revision, chapters_json, selected_id, updated_at)
         VALUES (?, 1, ?, NULL, ?)`,
      )
      .run(
        "legacy",
        JSON.stringify({ byId: {}, rootIds: [] }),
        "2025-01-01T00:00:00.000Z",
      );
    api.db
      .prepare(
        `INSERT INTO activity_entries
          (id, project_id, message, chapter_id, chapter_name, created_at,
           actor_user_id)
         VALUES (?, ?, ?, NULL, ?, ?, NULL)`,
      )
      .run(
        "legacy-event",
        "legacy",
        "Legacy activity",
        "Legacy project",
        "2025-01-01T00:00:00.000Z",
      );
    api.db
      .prepare(
        `INSERT INTO app_state (key, value)
         VALUES ('active_project_id', ?)`,
      )
      .run("legacy");

    await bootstrap({
      config: api.config,
      store: api.store,
      authStore: api.authStore,
      passwordHasher: createPasswordHasher({ testMode: true }),
    });

    expect(
      api.db
        .prepare("SELECT owner_id FROM projects WHERE id = ?")
        .get("legacy"),
    ).toEqual({ owner_id: superAdmin.id });
    expect(
      api.db
        .prepare("SELECT actor_user_id FROM activity_entries WHERE id = ?")
        .get("legacy-event"),
    ).toEqual({ actor_user_id: superAdmin.id });
    expect(api.store.getUserState(superAdmin.id).activeProjectId).toBe(
      "legacy",
    );
    expect(
      api.db.prepare("SELECT COUNT(*) AS count FROM app_state").get(),
    ).toEqual({ count: 0 });
  });

  it("is idempotent across repeated bootstrap calls", async () => {
    api = await createTestApi();
    const before = api.db.prepare("SELECT COUNT(*) AS count FROM users").get();
    await bootstrap({
      config: api.config,
      store: api.store,
      authStore: api.authStore,
      passwordHasher: createPasswordHasher({ testMode: true }),
    });
    expect(api.db.prepare("SELECT COUNT(*) AS count FROM users").get()).toEqual(
      before,
    );
    expect(
      api.db.prepare("SELECT COUNT(*) AS count FROM projects").get(),
    ).toEqual({ count: 2 });
  });
});
