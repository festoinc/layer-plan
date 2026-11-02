import {
  SCHEMA_VERSION,
  createId,
  createSampleWorkspace,
  createWorkspace,
  normalizeActivity,
  normalizeDocument,
  normalizeWorkspace,
  serializeActivity,
  serializeDocument,
  serializeUi,
  Workspace,
} from "../domain/schema";
import { getDefaultId } from "../domain/chapters";

export const STORAGE_KEYS = {
  document: "layers:doc:v3",
  activity: "layers:activity:v3",
  ui: "layers:ui:v3",
  backupPrefix: "layers:backup:",
  legacy: ["layers-chapters-v2", "layers-chapters-v1"],
};

export type ReadResult =
  | { status: "ok"; raw: string; value: any }
  | { status: "missing"; raw: null }
  | { status: "corrupt"; raw: string | null; error?: unknown };

export const STORAGE_STATUS = {
  saved: "saved" as const,
  pending: "pending" as const,
  error: "error" as const,
  unavailable: "unavailable" as const,
};

export type StorageStatusState =
  (typeof STORAGE_STATUS)[keyof typeof STORAGE_STATUS];

const ALL_KEYS = [
  STORAGE_KEYS.document,
  STORAGE_KEYS.activity,
  STORAGE_KEYS.ui,
];

/**
 * Minimal in-memory Storage implementation used when localStorage is blocked
 * (private mode, sandboxed frames) and by the unit tests.
 */
export function createMemoryStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() {
      return values.size;
    },
    clear() {
      values.clear();
    },
    getItem(key: string) {
      return values.has(key) ? (values.get(key) ?? null) : null;
    },
    key(index: number) {
      return [...values.keys()][index] ?? null;
    },
    removeItem(key: string) {
      values.delete(key);
    },
    setItem(key: string, value: string) {
      values.set(String(key), String(value));
    },
  };
}

function resolveStorage(storage?: Storage): {
  storage: Storage;
  available: boolean;
} {
  if (storage) return { storage, available: true };
  try {
    if (typeof window === "undefined" || !window.localStorage) {
      return { storage: createMemoryStorage(), available: false };
    }
    const probeKey = "layers:storage-probe";
    window.localStorage.setItem(probeKey, "1");
    window.localStorage.removeItem(probeKey);
    return { storage: window.localStorage, available: true };
  } catch {
    return { storage: createMemoryStorage(), available: false };
  }
}

export interface StorageNotice {
  level: "info" | "warning";
  message: string;
  backupKey?: string;
}

export interface RepositoryStatus {
  state: StorageStatusState;
  message: string;
}

export interface Repository {
  load: () => { workspace: Workspace; notices: StorageNotice[] };
  save: (workspace: Workspace, options?: { immediate?: boolean }) => void;
  flush: () => void;
  status: () => RepositoryStatus;
  onStatusChange: (listener: (status: RepositoryStatus) => void) => () => void;
  subscribe: (
    listener: (payload: {
      workspace?: Workspace;
      notices?: StorageNotice[];
    }) => void,
  ) => () => void;
  handleStorageEvent: (event: { key?: string | null }) => void;
  hasPending: () => boolean;
  exportWorkspace: (workspace: Workspace) => string;
  parseImport: (text: string) => { workspace: Workspace; issues: string[] };
  dispose: () => void;
}

export interface CreateRepositoryOptions {
  storage?: Storage;
  debounceMs?: number;
  windowObject?: (Window & typeof globalThis) | null;
  now?: () => string;
  newId?: () => string;
}

export function createRepository(
  options: CreateRepositoryOptions = {},
): Repository {
  const {
    storage: storageOption,
    debounceMs = 250,
    newId = createId,
  } = options;
  const now = options.now ?? (() => new Date().toISOString());
  const windowObject =
    options.windowObject === undefined
      ? typeof window === "undefined"
        ? null
        : window
      : options.windowObject;
  const { storage, available } = resolveStorage(storageOption);

  let pending: Workspace | null = null;
  let lastWritten: Workspace | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let currentStatus: RepositoryStatus = {
    state: available ? STORAGE_STATUS.saved : STORAGE_STATUS.unavailable,
    message: available
      ? "Saved in this browser."
      : "Browser storage is unavailable. Changes stay in this tab.",
  };
  const statusListeners = new Set<(status: RepositoryStatus) => void>();
  const syncListeners = new Set<
    (payload: { workspace?: Workspace; notices?: StorageNotice[] }) => void
  >();

  function setStatus(state: StorageStatusState, message: string) {
    if (currentStatus.state === state && currentStatus.message === message) {
      return;
    }
    currentStatus = { state, message };
    for (const listener of statusListeners) listener(currentStatus);
  }

  function readJson(key: string): ReadResult {
    let raw: string | null;
    try {
      raw = storage.getItem(key);
    } catch (error) {
      return { status: "corrupt", raw: null, error };
    }
    if (raw == null) return { status: "missing", raw: null };
    try {
      return { status: "ok", raw, value: JSON.parse(raw) };
    } catch (error) {
      return { status: "corrupt", raw, error };
    }
  }

  function backup(key: string, raw: string | null): string | null {
    if (!raw) return null;
    const backupKey = `${STORAGE_KEYS.backupPrefix}${key
      .replace(/^layers:/, "")
      .replace(/:/g, "-")}:${now()}`;
    try {
      storage.setItem(backupKey, raw);
      return backupKey;
    } catch {
      return null;
    }
  }

  function readLegacy(): ReadResult & { key: string | null } {
    for (const key of STORAGE_KEYS.legacy) {
      const result = readJson(key);
      if (result.status === "ok") return { ...result, key };
      if (result.status === "corrupt") return { ...result, key };
    }
    return { status: "missing", raw: null, key: null };
  }

  function workspaceFromPayloads(
    {
      document,
      activity,
      ui,
    }: { document: ReadResult; activity: ReadResult; ui: ReadResult },
    notices: StorageNotice[],
  ): Workspace {
    const documentPayload =
      document.status === "ok" &&
      document.value &&
      typeof document.value === "object"
        ? document.value
        : {};
    const { document: chapters, issues } = normalizeDocument(
      documentPayload.chapters,
      { newId },
    );
    if (issues.length) notices.push(...describeIssues(issues));

    const storedActivity =
      activity.status === "ok"
        ? activity.value
        : activity.status === "corrupt"
          ? null
          : documentPayload.events;
    const { events, issues: activityIssues } = normalizeActivity(
      storedActivity,
      {
        newId,
        now,
      },
    );
    if (activity.status === "corrupt") {
      const backupKey = backup(STORAGE_KEYS.activity, activity.raw);
      notices.push({
        level: "warning",
        message:
          "The saved activity history could not be read, so it was reset. The unreadable copy was kept as a backup.",
        backupKey: backupKey ?? undefined,
      });
    } else if (activityIssues.length) {
      notices.push(...describeIssues(activityIssues));
    }

    const selectedId =
      ui.status === "ok" && typeof ui.value?.selectedId === "string"
        ? getDefaultId(chapters, ui.value.selectedId)
        : getDefaultId(chapters, documentPayload.selectedId);

    return createWorkspace({
      project: documentPayload.project,
      chapters,
      events,
      selectedId,
    });
  }

  function describeIssues(issues: string[]): StorageNotice[] {
    return [
      {
        level: "warning",
        message: `Some saved data was repaired: ${issues
          .slice(0, 3)
          .join(
            " ",
          )}${issues.length > 3 ? ` (+${issues.length - 3} more)` : ""}`,
      },
    ];
  }

  function load(): { workspace: Workspace; notices: StorageNotice[] } {
    const notices: StorageNotice[] = [];
    const document = readJson(STORAGE_KEYS.document);
    let migrated = false;

    let workspace: Workspace;

    if (document.status === "ok") {
      const activity = readJson(STORAGE_KEYS.activity);
      const ui = readJson(STORAGE_KEYS.ui);
      workspace = workspaceFromPayloads({ document, activity, ui }, notices);
    } else if (document.status === "corrupt") {
      const backupKey = backup(STORAGE_KEYS.document, document.raw);
      notices.push({
        level: "warning",
        message:
          "The saved workspace could not be read. A backup of the unreadable data was kept, and the sample workspace was loaded.",
        backupKey: backupKey ?? undefined,
      });
      workspace = createSampleWorkspace();
    } else {
      const legacy = readLegacy();
      if (legacy.status === "ok") {
        const normalized = normalizeWorkspace(legacy.value, { newId, now });
        workspace = normalized.workspace;
        notices.push({
          level: "info",
          message: `Workspace upgraded from the previous storage format (${legacy.key}).`,
        });
        if (normalized.issues.length) {
          notices.push(...describeIssues(normalized.issues));
        }
        migrated = true;
      } else {
        if (legacy.status === "corrupt") {
          const backupKey = backup(legacy.key ?? "legacy", legacy.raw);
          notices.push({
            level: "warning",
            message:
              "The previous saved workspace could not be read. A backup was kept and the sample workspace was loaded.",
            backupKey: backupKey ?? undefined,
          });
        }
        workspace = createSampleWorkspace();
      }
    }

    if (!available) {
      setStatus(
        STORAGE_STATUS.unavailable,
        "Browser storage is unavailable. Changes stay in this tab.",
      );
    }

    pending = null;
    lastWritten = workspace;
    if (migrated) {
      pending = workspace;
      lastWritten = null;
      flush();
    }
    return { workspace, notices };
  }

  function write(workspace: Workspace) {
    if (!lastWritten || workspace.chapters !== lastWritten.chapters) {
      storage.setItem(
        STORAGE_KEYS.document,
        JSON.stringify(serializeDocument(workspace)),
      );
    }
    if (!lastWritten || workspace.events !== lastWritten.events) {
      storage.setItem(
        STORAGE_KEYS.activity,
        JSON.stringify(serializeActivity(workspace)),
      );
    }
    if (
      !lastWritten ||
      workspace.selectedId !== lastWritten.selectedId ||
      workspace.chapters !== lastWritten.chapters
    ) {
      storage.setItem(STORAGE_KEYS.ui, JSON.stringify(serializeUi(workspace)));
    }
  }

  function flush() {
    if (!pending) return;
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    const snapshot = pending;
    try {
      write(snapshot);
      lastWritten = snapshot;
      pending = null;
      if (available) setStatus(STORAGE_STATUS.saved, "All changes saved.");
    } catch (error) {
      pending = snapshot;
      setStatus(
        STORAGE_STATUS.error,
        error instanceof Error
          ? `Changes are not saved: ${error.message}`
          : "Changes are not saved.",
      );
    }
  }

  function save(workspace: Workspace, { immediate = false } = {}) {
    pending = workspace;
    if (immediate) {
      flush();
      return;
    }
    if (timer) clearTimeout(timer);
    if (available) setStatus(STORAGE_STATUS.pending, "Saving changes…");
    timer = setTimeout(() => {
      timer = null;
      flush();
    }, debounceMs);
  }

  function status(): RepositoryStatus {
    return currentStatus;
  }

  function onStatusChange(
    listener: (status: RepositoryStatus) => void,
  ): () => void {
    statusListeners.add(listener);
    return () => {
      statusListeners.delete(listener);
    };
  }

  function handleStorageEvent(event: { key?: string | null }) {
    const key = event?.key;
    if (key && !ALL_KEYS.includes(key)) return;
    if (pending) return;
    const { workspace, notices } = load();
    for (const listener of syncListeners) listener({ workspace, notices });
  }

  function subscribe(
    listener: (payload: {
      workspace?: Workspace;
      notices?: StorageNotice[];
    }) => void,
  ): () => void {
    syncListeners.add(listener);
    return () => {
      syncListeners.delete(listener);
    };
  }

  const onStorage = (event: StorageEvent) => handleStorageEvent(event);
  if (windowObject?.addEventListener) {
    windowObject.addEventListener("storage", onStorage as EventListener);
  }

  const flushOnHide = () => flush();
  if (windowObject?.addEventListener) {
    windowObject.addEventListener("pagehide", flushOnHide);
    windowObject.addEventListener("beforeunload", flushOnHide);
  }
  const visibilitySource =
    windowObject && "document" in windowObject ? windowObject.document : null;
  const onVisibility = () => {
    if (visibilitySource?.visibilityState === "hidden") flush();
  };
  if (visibilitySource?.addEventListener) {
    visibilitySource.addEventListener("visibilitychange", onVisibility);
  }

  function exportWorkspace(workspace: Workspace): string {
    return JSON.stringify(
      {
        schemaVersion: SCHEMA_VERSION,
        exportedAt: now(),
        project: workspace.project,
        chapters: workspace.chapters,
        events: workspace.events,
        selectedId: workspace.selectedId,
      },
      null,
      2,
    );
  }

  function parseImport(text: string): {
    workspace: Workspace;
    issues: string[];
  } {
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      return {
        workspace: createSampleWorkspace(),
        issues: ["The selected file is not valid JSON."],
      };
    }
    return normalizeWorkspace(parsed, { newId, now });
  }

  function dispose() {
    if (timer) clearTimeout(timer);
    timer = null;
    pending = null;
    if (windowObject?.removeEventListener) {
      windowObject.removeEventListener("storage", onStorage as EventListener);
      windowObject.removeEventListener("pagehide", flushOnHide);
      windowObject.removeEventListener("beforeunload", flushOnHide);
    }
    if (visibilitySource?.removeEventListener) {
      visibilitySource.removeEventListener("visibilitychange", onVisibility);
    }
    statusListeners.clear();
    syncListeners.clear();
  }

  return {
    load,
    save,
    flush,
    status,
    onStatusChange,
    subscribe,
    handleStorageEvent,
    hasPending: () => pending !== null,
    exportWorkspace,
    parseImport,
    dispose,
  };
}

export function downloadJson(
  json: string,
  filename: string = "layers-workspace.json",
): void {
  if (typeof document === "undefined") return;
  const blob = new Blob([json], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

export function readRawBackup(storage?: Storage): string {
  try {
    const source = storage ?? window.localStorage;
    const data: Record<string, string | null> = {};
    for (let index = 0; index < source.length; index += 1) {
      const key = source.key(index);
      if (!key) continue;
      if (!key.startsWith("layers")) continue;
      data[key] = source.getItem(key);
    }
    return JSON.stringify(data, null, 2);
  } catch {
    return "{}";
  }
}
