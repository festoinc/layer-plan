import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  STORAGE_STATUS,
  createMemoryStorage,
  createProjectRepository,
  projectKeys,
} from "../../src/store/persistence.js";
import {
  createChapter,
  createEmptyDocument,
  insertChapter,
} from "../../src/domain/chapters.js";
import { createWorkspace } from "../../src/domain/schema.js";

const fixedNow = () => "2026-01-01T00:00:00.000Z";
const projectId = "project-one";
const keys = projectKeys(projectId);

function workspaceWith(title = "Chapter") {
  const chapters = insertChapter(
    createEmptyDocument(),
    createChapter({ id: "one", title }),
  );
  return createWorkspace({ projectId, chapters, selectedId: "one" });
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
  return createProjectRepository({
    projectId,
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

describe("project persistence", () => {
  it("starts a missing project with an empty document without writing", () => {
    const { storage, writes } = recordingStorage();
    const repo = repository(storage);
    const { workspace, notices } = repo.load();

    expect(notices).toEqual([]);
    expect(workspace.projectId).toBe(projectId);
    expect(workspace.chapters.rootIds).toEqual([]);
    expect(writes).toEqual([]);
    expect(repo.status().state).toBe(STORAGE_STATUS.saved);
  });

  it("loads a saved project and restores its selected chapter", () => {
    const { storage } = recordingStorage();
    const first = repository(storage);
    first.load();
    first.save(workspaceWith("Persisted"), { immediate: true });
    first.dispose();

    const second = repository(storage);
    const { workspace } = second.load();
    expect(workspace.chapters.byId.one.title).toBe("Persisted");
    expect(workspace.selectedId).toBe("one");
    expect(JSON.parse(storage.getItem(keys.document)).schemaVersion).toBe(6);
    expect(JSON.parse(storage.getItem(keys.document)).projectId).toBe(
      projectId,
    );
  });

  it("debounces writes and flushes them on demand", () => {
    const { storage } = recordingStorage();
    const repo = repository(storage);
    repo.load();

    repo.save(workspaceWith());
    expect(storage.getItem(keys.document)).toBeNull();
    expect(repo.status().state).toBe(STORAGE_STATUS.pending);

    vi.advanceTimersByTime(249);
    expect(storage.getItem(keys.document)).toBeNull();
    vi.advanceTimersByTime(1);

    const saved = JSON.parse(storage.getItem(keys.document));
    expect(saved.schemaVersion).toBe(6);
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
      JSON.parse(storage.getItem(keys.document)).chapters.byId.one.title,
    ).toBe("Immediate");
  });

  it("only rewrites the parts that changed", () => {
    const { storage, writes } = recordingStorage();
    const repo = repository(storage);
    const base = repo.load().workspace;

    const first = { ...base, chapters: { ...base.chapters } };
    repo.save(first, { immediate: true });
    writes.length = 0;

    repo.save({ ...first, selectedId: first.selectedId }, { immediate: true });
    expect(writes).toEqual([]);

    repo.save({ ...first, events: [] }, { immediate: true });
    expect(writes).toEqual([keys.activity]);
  });

  it("reports document flushes to the catalog only when chapters change", () => {
    const changes = [];
    const repo = repository(createMemoryStorage(), {
      onFlush: (_workspace, changed) => changes.push(changed.document),
    });
    const base = repo.load().workspace;

    repo.save({ ...base, selectedId: base.selectedId }, { immediate: true });
    expect(changes).toEqual([false]);

    repo.save(workspaceWith("Changed"), { immediate: true });
    expect(changes).toEqual([false, true]);
  });

  it("ignores the phase 1/2 legacy keys", () => {
    const { storage } = recordingStorage();
    storage.setItem(
      "layers:doc:v3",
      JSON.stringify({
        project: { id: "website", name: "Old", account: "W" },
        chapters: {
          byId: {
            old: { id: "old", title: "Old", criteria: [], childIds: [] },
          },
          rootIds: ["old"],
        },
      }),
    );
    const repo = repository(storage);
    const { workspace } = repo.load();
    expect(workspace.chapters.rootIds).toEqual([]);
    expect(storage.getItem("layers:doc:v3")).not.toBeNull();
  });

  it("backs up a corrupt document instead of losing it silently", () => {
    const { storage } = recordingStorage();
    storage.setItem(keys.document, "{not json");
    const repo = repository(storage);
    const { workspace, notices } = repo.load();

    expect(notices[0].level).toBe("warning");
    expect(notices[0].backupKey).toBeTruthy();
    expect(storage.getItem(notices[0].backupKey)).toBe("{not json");
    expect(workspace.chapters.rootIds).toEqual([]);
    expect(JSON.parse(storage.getItem(keys.document)).chapters.rootIds).toEqual(
      [],
    );
  });

  it("backs up corrupt activity and keeps the document", () => {
    const { storage } = recordingStorage();
    const seed = repository(storage);
    seed.load();
    seed.save(workspaceWith("Kept"), { immediate: true });
    seed.dispose();
    storage.setItem(keys.activity, "{not json");

    const repo = repository(storage);
    const { workspace, notices } = repo.load();
    expect(workspace.chapters.byId.one.title).toBe("Kept");
    expect(workspace.events).toEqual([]);
    expect(notices.some((notice) => notice.backupKey)).toBe(true);
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
      JSON.parse(source.getItem(keys.document)).chapters.byId.one.title,
    ).toBe("Unsaved");
  });

  it("marks storage unavailable when no storage can be opened", () => {
    const repo = createProjectRepository({ projectId, windowObject: null });
    const { workspace } = repo.load();
    expect(workspace.chapters.rootIds).toEqual([]);
    expect(repo.status().state).toBe(STORAGE_STATUS.unavailable);
  });

  it("adopts external writes only when there is nothing pending", () => {
    const storage = createMemoryStorage();
    const repo = repository(storage);
    repo.load();
    repo.save(workspaceWith("External"), { immediate: true });

    const received = [];
    const unsubscribe = repo.subscribe((payload) =>
      received.push(payload.workspace?.chapters.byId.one?.title),
    );
    expect(repo.handleStorageEvent({ key: keys.document })).toBeUndefined();
    expect(received.at(-1)).toBe("External");

    repo.save(workspaceWith("Local pending"));
    const before = received.length;
    repo.handleStorageEvent({ key: keys.document });
    expect(received.length).toBe(before);
    repo.handleStorageEvent({ key: "other-app-key" });
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
