import {
  SCHEMA_VERSION,
  createId,
  createWorkspace,
  normalizeActivity,
  normalizeDocument,
  serializeActivity,
  serializeDocument,
  serializeUi,
  Workspace,
} from "../domain/schema";
import { getDefaultId } from "../domain/chapters";

export const STORAGE_KEYS = {
  index: "layers:projects:v5",
  backupPrefix: "layers:backup:",
  projectPrefix: "layers:project:",
  legacy: [
    "layers:projects:v4",
    "layers:doc:v3",
    "layers:activity:v3",
    "layers:ui:v3",
    "layers-chapters-v2",
    "layers-chapters-v1",
  ],
};

export interface ProjectStorageKeys {
  document: string;
  activity: string;
  ui: string;
  settings: string;
}

export function projectKeys(projectId: string): ProjectStorageKeys {
  return {
    document: `${STORAGE_KEYS.projectPrefix}${projectId}:doc:v5`,
    activity: `${STORAGE_KEYS.projectPrefix}${projectId}:activity:v5`,
    ui: `${STORAGE_KEYS.projectPrefix}${projectId}:ui:v5`,
    settings: `${STORAGE_KEYS.projectPrefix}${projectId}:settings:v5`,
  };
}

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

export interface StorageNotice {
  level: "info" | "warning";
  message: string;
  backupKey?: string;
}

export interface RepositoryStatus {
  state: StorageStatusState;
  message: string;
}

export interface ChangedSlices {
  document: boolean;
  activity: boolean;
  ui: boolean;
}

export interface ProjectRepository {
  projectId: string;
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
  dispose: () => void;
}

export interface CreateProjectRepositoryOptions {
  projectId: string;
  storage?: Storage;
  debounceMs?: number;
  windowObject?: (Window & typeof globalThis) | null;
  now?: () => string;
  newId?: () => string;
  onFlush?: (workspace: Workspace, changed: ChangedSlices) => void;
}

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

export function resolveStorage(storage?: Storage): {
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

export function readJson(storage: Storage, key: string): ReadResult {
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

export function backupValue(
  storage: Storage,
  key: string,
  raw: string | null,
  now: () => string,
): string | null {
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

export function listStorageKeys(storage: Storage): string[] {
  const keys: string[] = [];
  try {
    for (let index = 0; index < storage.length; index += 1) {
      const key = storage.key(index);
      if (key) keys.push(key);
    }
  } catch {
    return [];
  }
  return keys;
}

export function removeStorageKeys(storage: Storage, keys: Iterable<string>) {
  for (const key of keys) {
    try {
      storage.removeItem(key);
    } catch {
      // Best effort: a blocked storage cannot be repaired here.
    }
  }
}

function describeIssues(issues: string[]): StorageNotice[] {
  return [
    {
      level: "warning",
      message: `Some saved data was repaired: ${issues
        .slice(0, 3)
        .join(" ")}${issues.length > 3 ? ` (+${issues.length - 3} more)` : ""}`,
    },
  ];
}

export function createProjectRepository(
  options: CreateProjectRepositoryOptions,
): ProjectRepository {
  const {
    projectId,
    storage: storageOption,
    debounceMs = 250,
    newId = createId,
    onFlush,
  } = options;
  const now = options.now ?? (() => new Date().toISOString());
  const windowObject =
    options.windowObject === undefined
      ? typeof window === "undefined"
        ? null
        : window
      : options.windowObject;
  const { storage, available } = resolveStorage(storageOption);
  const keys = projectKeys(projectId);
  const allKeys = [keys.document, keys.activity, keys.ui];

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

  function load(): { workspace: Workspace; notices: StorageNotice[] } {
    const notices: StorageNotice[] = [];
    let repaired = false;
    const document = readJson(storage, keys.document);
    const activity = readJson(storage, keys.activity);
    const ui = readJson(storage, keys.ui);

    let documentPayload: Record<string, any> = {};
    let chapters = createWorkspace({ projectId }).chapters;

    if (document.status === "ok" && document.value) {
      documentPayload =
        typeof document.value === "object" ? document.value : {};
      const normalized = normalizeDocument(
        documentPayload.chapters ?? documentPayload,
        { newId },
      );
      chapters = normalized.document;
      if (normalized.issues.length) {
        notices.push(...describeIssues(normalized.issues));
      }
    } else if (document.status === "corrupt") {
      repaired = true;
      const backupKey = backupValue(storage, keys.document, document.raw, now);
      notices.push({
        level: "warning",
        message:
          "This project could not be read. A backup of the unreadable data was kept, and the project was opened with an empty document.",
        backupKey: backupKey ?? undefined,
      });
    }

    const activitySource =
      activity.status === "ok"
        ? (activity.value?.events ?? activity.value)
        : activity.status === "corrupt"
          ? null
          : documentPayload.events;
    const normalizedActivity = normalizeActivity(activitySource, {
      newId,
      now,
    });
    if (activity.status === "corrupt") {
      repaired = true;
      const backupKey = backupValue(storage, keys.activity, activity.raw, now);
      notices.push({
        level: "warning",
        message:
          "The project activity could not be read, so it was reset. The unreadable copy was kept as a backup.",
        backupKey: backupKey ?? undefined,
      });
    } else if (normalizedActivity.issues.length) {
      notices.push(...describeIssues(normalizedActivity.issues));
    }

    const selectedId =
      ui.status === "ok" && typeof ui.value?.selectedId === "string"
        ? getDefaultId(chapters, ui.value.selectedId)
        : getDefaultId(chapters, documentPayload.selectedId);

    const workspace = createWorkspace({
      projectId,
      chapters,
      events: normalizedActivity.events,
      selectedId,
    });

    if (!available) {
      setStatus(
        STORAGE_STATUS.unavailable,
        "Browser storage is unavailable. Changes stay in this tab.",
      );
    }

    pending = null;
    lastWritten = workspace;
    if (repaired && available) {
      pending = workspace;
      lastWritten = null;
      flush();
    }
    return { workspace, notices };
  }

  function write(workspace: Workspace): ChangedSlices {
    const changed: ChangedSlices = {
      document: false,
      activity: false,
      ui: false,
    };
    if (!lastWritten || workspace.chapters !== lastWritten.chapters) {
      storage.setItem(
        keys.document,
        JSON.stringify(serializeDocument(workspace)),
      );
      changed.document = true;
    }
    if (!lastWritten || workspace.events !== lastWritten.events) {
      storage.setItem(
        keys.activity,
        JSON.stringify(serializeActivity(workspace)),
      );
      changed.activity = true;
    }
    if (
      !lastWritten ||
      workspace.selectedId !== lastWritten.selectedId ||
      workspace.chapters !== lastWritten.chapters
    ) {
      storage.setItem(keys.ui, JSON.stringify(serializeUi(workspace)));
      changed.ui = true;
    }
    return changed;
  }

  function flush() {
    if (!pending) return;
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    const snapshot = pending;
    try {
      const changed = write(snapshot);
      lastWritten = snapshot;
      pending = null;
      if (available) setStatus(STORAGE_STATUS.saved, "All changes saved.");
      try {
        onFlush?.(snapshot, changed);
      } catch {
        setStatus(
          STORAGE_STATUS.error,
          "Changes are saved, but the project list could not be updated.",
        );
      }
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

  function handleStorageEvent(event: { key?: string | null }) {
    const key = event?.key;
    if (key && !allKeys.includes(key)) return;
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
    projectId,
    load,
    save,
    flush,
    status: () => currentStatus,
    onStatusChange: (listener) => {
      statusListeners.add(listener);
      return () => statusListeners.delete(listener);
    },
    subscribe,
    handleStorageEvent,
    hasPending: () => pending !== null,
    dispose,
  };
}

export function downloadJson(
  json: string,
  filename: string = "layers-project.json",
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

export { SCHEMA_VERSION };
