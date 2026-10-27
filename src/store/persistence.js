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
} from "../domain/schema.js";
import { getDefaultId } from "../domain/chapters.js";

export const STORAGE_KEYS = {
  document: "layers:doc:v3",
  activity: "layers:activity:v3",
  ui: "layers:ui:v3",
  backupPrefix: "layers:backup:",
  legacy: ["layers-chapters-v2", "layers-chapters-v1"],
};

/**
 * @typedef {{ status: "ok", raw: string, value: any }
 *   | { status: "missing", raw: null }
 *   | { status: "corrupt", raw: string|null, error?: unknown }} ReadResult
 */

export const STORAGE_STATUS = {
  saved: /** @type {"saved"} */ ("saved"),
  pending: /** @type {"pending"} */ ("pending"),
  error: /** @type {"error"} */ ("error"),
  unavailable: /** @type {"unavailable"} */ ("unavailable"),
};

const ALL_KEYS = [
  STORAGE_KEYS.document,
  STORAGE_KEYS.activity,
  STORAGE_KEYS.ui,
];

/**
 * Minimal in-memory Storage implementation used when localStorage is blocked
 * (private mode, sandboxed frames) and by the unit tests.
 *
 * @returns {Storage}
 */
export function createMemoryStorage() {
  /** @type {Map<string, string>} */
  const values = new Map();
  return {
    get length() {
      return values.size;
    },
    clear() {
      values.clear();
    },
    getItem(key) {
      return values.has(key) ? (values.get(key) ?? null) : null;
    },
    key(index) {
      return [...values.keys()][index] ?? null;
    },
    removeItem(key) {
      values.delete(key);
    },
    setItem(key, value) {
      values.set(String(key), String(value));
    },
  };
}

/**
 * @param {Storage} [storage]
 * @returns {{ storage: Storage, available: boolean }}
 */
function resolveStorage(storage) {
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

/**
 * @typedef {Object} StorageNotice
 * @property {"info"|"warning"} level
 * @property {string} message
 * @property {string} [backupKey]
 */

/**
 * @typedef {Object} RepositoryStatus
 * @property {"saved"|"pending"|"error"|"unavailable"} state
 * @property {string} message
 */

/**
 * @typedef {Object} Repository
 * @property {() => { workspace: import("../domain/schema.js").Workspace, notices: StorageNotice[] }} load
 * @property {(workspace: import("../domain/schema.js").Workspace, options?: { immediate?: boolean }) => void} save
 * @property {() => void} flush
 * @property {() => RepositoryStatus} status
 * @property {(listener: (status: RepositoryStatus) => void) => () => void} onStatusChange
 * @property {(listener: (payload: { workspace: import("../domain/schema.js").Workspace, notices: StorageNotice[] }) => void) => () => void} subscribe
 * @property {(event: { key?: string|null }) => void} handleStorageEvent
 * @property {() => boolean} hasPending
 * @property {(workspace: import("../domain/schema.js").Workspace) => string} exportWorkspace
 * @property {(text: string) => { workspace: import("../domain/schema.js").Workspace, issues: string[] }} parseImport
 * @property {() => void} dispose
 */

/**
 * @param {{
 *   storage?: Storage,
 *   debounceMs?: number,
 *   windowObject?: (Window & typeof globalThis) | null,
 *   now?: () => string,
 *   newId?: () => string,
 * }} [options]
 * @returns {Repository}
 */
export function createRepository(options = {}) {
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

  /** @type {import("../domain/schema.js").Workspace|null} */
  let pending = null;
  /** @type {import("../domain/schema.js").Workspace|null} */
  let lastWritten = null;
  /** @type {ReturnType<typeof setTimeout>|null} */
  let timer = null;
  /** @type {RepositoryStatus} */
  let currentStatus = {
    state: available ? STORAGE_STATUS.saved : STORAGE_STATUS.unavailable,
    message: available
      ? "Saved in this browser."
      : "Browser storage is unavailable. Changes stay in this tab.",
  };
  const statusListeners = new Set();
  const syncListeners = new Set();

  /**
   * @param {RepositoryStatus["state"]} state
   * @param {string} message
   */
  function setStatus(state, message) {
    if (currentStatus.state === state && currentStatus.message === message) {
      return;
    }
    currentStatus = { state, message };
    for (const listener of statusListeners) listener(currentStatus);
  }

  /**
   * @param {string} key
   * @returns {ReadResult}
   */
  function readJson(key) {
    let raw;
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

  /**
   * @param {string} key
   * @param {string|null} raw
   * @returns {string|null}
   */
  function backup(key, raw) {
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

  /** @returns {ReadResult & { key: string|null }} */
  function readLegacy() {
    for (const key of STORAGE_KEYS.legacy) {
      const result = readJson(key);
      if (result.status === "ok") return { ...result, key };
      if (result.status === "corrupt") return { ...result, key };
    }
    return { status: "missing", raw: null, key: null };
  }

  /**
   * @param {{ document: ReadResult, activity: ReadResult, ui: ReadResult }} payloads
   * @param {StorageNotice[]} notices
   * @returns {import("../domain/schema.js").Workspace}
   */
  function workspaceFromPayloads({ document, activity, ui }, notices) {
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

  /**
   * @param {string[]} issues
   * @returns {StorageNotice[]}
   */
  function describeIssues(issues) {
    return [
      {
        level: /** @type {const} */ ("warning"),
        message: `Some saved data was repaired: ${issues
          .slice(0, 3)
          .join(
            " ",
          )}${issues.length > 3 ? ` (+${issues.length - 3} more)` : ""}`,
      },
    ];
  }

  /** @type {Repository["load"]} */
  function load() {
    /** @type {StorageNotice[]} */
    const notices = [];
    const document = readJson(STORAGE_KEYS.document);
    let migrated = false;

    /** @type {import("../domain/schema.js").Workspace} */
    let workspace;

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

    // Treat the loaded workspace as already persisted so loading never rewrites
    // storage (which would ping-pong between tabs). Migration is the only case
    // that writes immediately.
    pending = null;
    lastWritten = workspace;
    if (migrated) {
      pending = workspace;
      lastWritten = null;
      flush();
    }
    return { workspace, notices };
  }

  /**
   * @param {import("../domain/schema.js").Workspace} workspace
   */
  function write(workspace) {
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

  /** @type {Repository["flush"]} */
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

  /** @type {Repository["save"]} */
  function save(workspace, { immediate = false } = {}) {
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

  /** @type {Repository["status"]} */
  function status() {
    return currentStatus;
  }

  /** @type {Repository["onStatusChange"]} */
  function onStatusChange(listener) {
    statusListeners.add(listener);
    return () => {
      statusListeners.delete(listener);
    };
  }

  /** @type {Repository["handleStorageEvent"]} */
  function handleStorageEvent(event) {
    const key = event?.key;
    if (key && !ALL_KEYS.includes(key)) return;
    if (pending) return;
    const { workspace, notices } = load();
    for (const listener of syncListeners) listener({ workspace, notices });
  }

  /** @type {Repository["subscribe"]} */
  function subscribe(listener) {
    syncListeners.add(listener);
    return () => {
      syncListeners.delete(listener);
    };
  }

  /** @param {{ key?: string|null }} event */
  const onStorage = (event) => handleStorageEvent(event);
  if (windowObject?.addEventListener) {
    windowObject.addEventListener("storage", onStorage);
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

  /** @type {Repository["exportWorkspace"]} */
  function exportWorkspace(workspace) {
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

  /** @type {Repository["parseImport"]} */
  function parseImport(text) {
    let parsed;
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
      windowObject.removeEventListener("storage", onStorage);
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

/**
 * Download a JSON export of a workspace in the browser.
 *
 * @param {string} json
 * @param {string} [filename]
 */
export function downloadJson(json, filename = "layers-workspace.json") {
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

/**
 * Best-effort raw backup of everything this app stores, for the error screen.
 *
 * @param {Storage} [storage]
 * @returns {string}
 */
export function readRawBackup(storage) {
  try {
    const source = storage ?? window.localStorage;
    /** @type {Record<string,string|null>} */
    const data = {};
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
