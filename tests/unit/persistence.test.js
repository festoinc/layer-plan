import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  STORAGE_KEYS,
  STORAGE_STATUS,
  createMemoryStorage,
  createRepository,
} from "../../src/store/persistence.js";
import {
  createChapter,
  createEmptyDocument,
  insertChapter,
} from "../../src/domain/chapters.js";
import { createWorkspace } from "../../src/domain/schema.js";

const fixedNow = () => "2026-01-01T00:00:00.000Z";

function workspaceWith(title = "Chapter") {
  const chapters = insertChapter(
    createEmptyDocument(),
    createChapter({ id: "one", title }),
  );
  return createWorkspace({ chapters, selectedId: "one" });
}

function recordingStorage() {
  const storage = createMemoryStorage();
  const writes = [];
  return {
    storage: {
      ...storage,
      setItem(key, value) {
        writes.push(key);
        storage.setItem(key, value);
      },
    },
    writes,
  };
}

function repository(storage, options = {}) {
  return createRepository({
    storage,
    debounceMs: 250,
    windowObject: null,
    now: fixedNow,
    newId: (() => {
      let counter = 0;
      return () => `new-${(counter += 1)}`;
    })(),
    ...options,
  });
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("persistence", () => {
  it("starts from the sample workspace without touching storage", () => {
    const { storage, writes } = recordingStorage();
    const repo = repository(storage);
    const { workspace, notices } = repo.load();

    expect(notices).toEqual([]);
    expect(workspace.chapters.rootIds.length).toBeGreaterThan(0);
    expect(writes).toEqual([]);
    expect(repo.status().state).toBe(STORAGE_STATUS.saved);
  });

  it("debounces writes and flushes them on demand", () => {
    const { storage } = recordingStorage();
    const repo = repository(storage);
    repo.load();

    repo.save(workspaceWith());
    expect(storage.getItem(STORAGE_KEYS.document)).toBeNull();
    expect(repo.status().state).toBe(STORAGE_STATUS.pending);

    vi.advanceTimersByTime(249);
    expect(storage.getItem(STORAGE_KEYS.document)).toBeNull();
    vi.advanceTimersByTime(1);

    const saved = JSON.parse(storage.getItem(STORAGE_KEYS.document));
    expect(saved.schemaVersion).toBe(3);
    expect(saved.chapters.byId.one.title).toBe("Chapter");
    expect(repo.status().state).toBe(STORAGE_STATUS.saved);
    expect(repo.hasPending()).toBe(false);
  });

  it("writes structural changes immediately", () => {
    const { storage } = recordingStorage();
    const repo = repository(storage);
    repo.load();
    repo.save(workspaceWith("Immediate"), { immediate: true });
    expect(
      JSON.parse(storage.getItem(STORAGE_KEYS.document)).chapters.byId.one
        .title,
    ).toBe("Immediate");
  });

  it("only rewrites the parts that changed", () => {
    const { storage, writes } = recordingStorage();
    const repo = repository(storage);
    const base = repo.load().workspace;

    const first = { ...base, chapters: { ...base.chapters } };
    repo.save(first, { immediate: true });
    writes.length = 0;

    repo.save({ ...first, events: [] }, { immediate: true });
    expect(writes).toEqual([STORAGE_KEYS.activity]);
  });

  it("migrates the phase 1 nested payload into v3 keys", () => {
    const { storage } = recordingStorage();
    storage.setItem(
      "layers-chapters-v2",
      JSON.stringify({
        chapters: [
          {
            id: "legacy",
            title: "Legacy chapter",
            description: "From v2",
            criteria: [{ id: "c1", text: "Legacy criterion", checked: true }],
            children: [],
          },
        ],
        selectedId: "legacy",
        events: [{ id: "e1", message: "Old event", time: fixedNow() }],
      }),
    );

    const repo = repository(storage);
    const { workspace, notices } = repo.load();

    expect(workspace.chapters.byId.legacy.title).toBe("Legacy chapter");
    expect(workspace.selectedId).toBe("legacy");
    expect(workspace.events).toHaveLength(1);
    expect(notices[0].message).toContain("upgraded");
    expect(repo.status().state).toBe(STORAGE_STATUS.saved);

    const document = JSON.parse(storage.getItem(STORAGE_KEYS.document));
    expect(document.chapters.byId.legacy.parentId).toBeNull();
    expect(
      JSON.parse(storage.getItem(STORAGE_KEYS.activity)).events,
    ).toHaveLength(1);
    expect(JSON.parse(storage.getItem(STORAGE_KEYS.ui)).selectedId).toBe(
      "legacy",
    );
    // The legacy key is preserved for rollback.
    expect(storage.getItem("layers-chapters-v2")).not.toBeNull();
  });

  it("backs up a corrupt document instead of losing it silently", () => {
    const { storage } = recordingStorage();
    storage.setItem(STORAGE_KEYS.document, "{not json");
    const repo = repository(storage);
    const { workspace, notices } = repo.load();

    expect(notices[0].level).toBe("warning");
    expect(notices[0].backupKey).toBeTruthy();
    expect(storage.getItem(notices[0].backupKey)).toBe("{not json");
    expect(workspace.chapters.rootIds.length).toBeGreaterThan(0);
  });

  it("reports write failures and recovers on retry", () => {
    const source = createMemoryStorage();
    let failing = true;
    const storage = {
      ...source,
      setItem(key, value) {
        if (failing) throw new Error("Quota exceeded");
        source.setItem(key, value);
      },
    };
    const repo = repository(storage);
    repo.load();
    repo.save(workspaceWith("Unsaved"), { immediate: true });

    expect(repo.status().state).toBe(STORAGE_STATUS.error);
    expect(repo.status().message).toContain("Quota exceeded");
    expect(repo.hasPending()).toBe(true);

    failing = false;
    repo.flush();
    expect(repo.status().state).toBe(STORAGE_STATUS.saved);
    expect(
      JSON.parse(source.getItem(STORAGE_KEYS.document)).chapters.byId.one.title,
    ).toBe("Unsaved");
  });

  it("marks storage unavailable when no storage can be opened", () => {
    const repo = createRepository({ windowObject: null });
    const { workspace } = repo.load();
    expect(workspace.chapters.rootIds.length).toBeGreaterThan(0);
    expect(repo.status().state).toBe(STORAGE_STATUS.unavailable);
  });

  it("exports and re-imports a workspace", () => {
    const repo = repository(createMemoryStorage());
    const { workspace } = repo.load();
    const json = repo.exportWorkspace(workspace);
    const parsed = JSON.parse(json);
    expect(parsed.schemaVersion).toBe(3);
    expect(parsed.chapters.byId["password-reset"]).toBeDefined();

    const { workspace: imported, issues } = repo.parseImport(json);
    expect(issues).toEqual([]);
    expect(imported.chapters.byId["password-reset"].title).toBe(
      "Password reset",
    );
    expect(repo.parseImport("{").issues[0]).toContain("valid JSON");
  });

  it("adopts external writes only when there is nothing pending", () => {
    const storage = createMemoryStorage();
    const repo = repository(storage);
    repo.load();
    const received = [];
    const unsubscribe = repo.subscribe((payload) =>
      received.push(payload.workspace.selectedId),
    );

    const external = workspaceWith("External");
    repo.save(external, { immediate: true });
    expect(repo.handleStorageEvent({ key: STORAGE_KEYS.document }));
    expect(received.at(-1)).toBe("one");

    repo.save(workspaceWith("Local pending"));
    const before = received.length;
    repo.handleStorageEvent({ key: STORAGE_KEYS.document });
    expect(received.length).toBe(before);
    expect(repo.handleStorageEvent({ key: "other-app-key" }));
    expect(received.length).toBe(before);
    unsubscribe();
  });

  it("notifies status listeners", () => {
    const repo = repository(createMemoryStorage());
    repo.load();
    const states = [];
    const unsubscribe = repo.onStatusChange((status) =>
      states.push(status.state),
    );
    repo.save(workspaceWith(), { immediate: true });
    expect(states.at(-1)).toBe(STORAGE_STATUS.saved);
    unsubscribe();
  });
});
