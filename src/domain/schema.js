import { initialChapters } from "../data.js";
import { createEmptyDocument, getDefaultId } from "./chapters.js";
import { MAX_ACTIVITY_ENTRIES } from "./activity.js";

/**
 * @typedef {import("./chapters.js").Chapter} Chapter
 * @typedef {import("./chapters.js").Criterion} Criterion
 * @typedef {import("./chapters.js").ChapterDocument} ChapterDocument
 * @typedef {import("./activity.js").ActivityEntry} ActivityEntry
 */

export const SCHEMA_VERSION = 3;

/** @typedef {{ id: string, name: string, account: string }} Project */

/** @type {Project} */
export const SAMPLE_PROJECT = {
  id: "website",
  name: "Website project",
  account: "W",
};

/**
 * @typedef {Object} Workspace
 * @property {number} schemaVersion
 * @property {Project} project
 * @property {ChapterDocument} chapters
 * @property {ActivityEntry[]} events
 * @property {string|null} selectedId
 */

/**
 * @param {unknown} value
 * @returns {value is Record<string, any>}
 */
const isRecord = (value) =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * @param {unknown} value
 * @returns {value is string}
 */
const isString = (value) => typeof value === "string";

/** @returns {string} */
export function createId() {
  if (
    typeof globalThis.crypto !== "undefined" &&
    typeof globalThis.crypto.randomUUID === "function"
  ) {
    return globalThis.crypto.randomUUID();
  }
  return `id-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * @param {unknown} [input]
 * @returns {Project}
 */
export function createProject(input = {}) {
  const source = isRecord(input) ? input : {};
  return {
    id: isString(source.id) && source.id ? source.id : SAMPLE_PROJECT.id,
    name:
      isString(source.name) && source.name.trim()
        ? source.name.trim()
        : SAMPLE_PROJECT.name,
    account:
      isString(source.account) && source.account.trim()
        ? source.account.trim().slice(0, 2)
        : SAMPLE_PROJECT.account,
  };
}

/**
 * @param {Partial<Workspace>} [input]
 * @returns {Workspace}
 */
export function createWorkspace(input = {}) {
  const chapters = input.chapters ?? createEmptyDocument();
  return {
    schemaVersion: SCHEMA_VERSION,
    project: createProject(input.project),
    chapters,
    events: input.events ? [...input.events] : [],
    selectedId: getDefaultId(chapters, input.selectedId),
  };
}

/**
 * Coerce a chapter record, repairing missing or malformed fields.
 *
 * @param {unknown} raw
 * @param {{ id: string, parentId: string|null, newId: () => string, issues: string[] }} context
 * @returns {Chapter|null}
 */
function coerceChapter(raw, { id, parentId, newId, issues }) {
  if (!isRecord(raw)) {
    issues.push("Skipped a chapter that is not an object.");
    return null;
  }

  let title = isString(raw.title) ? raw.title.trim() : "";
  if (!title) title = "Untitled chapter";

  const criteria = normalizeCriteria(raw.criteria, { newId, issues });

  return {
    id,
    parentId,
    title,
    description: isString(raw.description) ? raw.description : "",
    finalLevel: raw.finalLevel === true,
    criteria,
    childIds: [],
  };
}

/**
 * @param {unknown} raw
 * @param {{ newId: () => string, issues: string[] }} context
 * @returns {Criterion[]}
 */
function normalizeCriteria(raw, { newId, issues }) {
  if (raw == null) return [];
  if (!Array.isArray(raw)) {
    issues.push("Replaced a criterion list that was not an array.");
    return [];
  }

  /** @type {Criterion[]} */
  const criteria = [];
  const usedIds = new Set();

  for (const item of raw) {
    if (!isRecord(item)) {
      issues.push("Skipped a criterion that is not an object.");
      continue;
    }
    if (!isString(item.text)) {
      issues.push("Skipped a criterion without text.");
      continue;
    }

    let id = isString(item.id) && item.id ? item.id : newId();
    if (usedIds.has(id)) {
      issues.push(`Replaced a duplicate criterion id (${id}).`);
      id = newId();
    }
    usedIds.add(id);

    /** @type {Criterion} */
    const criterion = {
      id,
      text: item.text,
      checked: item.checked === true,
    };
    if (isString(item.chapterId) && item.chapterId) {
      criterion.chapterId = item.chapterId;
    }
    criteria.push(criterion);
  }

  return criteria;
}

/**
 * Accepts either a normalized document, a nested phase 1 chapter array, or a
 * payload wrapper containing `chapters`.
 *
 * @param {unknown} raw
 * @param {{ newId?: () => string }} [options]
 * @returns {{ document: ChapterDocument, issues: string[] }}
 */
export function normalizeDocument(raw, options = {}) {
  const newId = options.newId ?? createId;
  /** @type {string[]} */
  const issues = [];
  let input = raw;

  if (isRecord(input) && "chapters" in input) input = input.chapters;

  if (Array.isArray(input)) {
    return normalizeNested(input, { newId, issues });
  }
  if (isRecord(input) && isRecord(input.byId) && Array.isArray(input.rootIds)) {
    return normalizeNormalized(input, { newId, issues });
  }

  issues.push("The saved workspace did not contain usable chapters.");
  return { document: createEmptyDocument(), issues };
}

/**
 * Phase 1 shape: `Chapter[]` with nested `children`.
 *
 * @param {unknown[]} rawChapters
 * @param {{ newId: () => string, issues: string[] }} context
 * @returns {{ document: ChapterDocument, issues: string[] }}
 */
function normalizeNested(rawChapters, context) {
  const { newId, issues } = context;
  /** @type {Record<string, Chapter>} */
  const byId = {};
  const usedIds = new Set();

  /** @param {unknown[]} list @param {string|null} parentId */
  const visit = (list, parentId) => {
    /** @type {string[]} */
    const childIds = [];
    for (const raw of list) {
      if (!isRecord(raw)) {
        issues.push("Skipped a chapter that is not an object.");
        continue;
      }
      let id = isString(raw.id) && raw.id ? raw.id : newId();
      if (usedIds.has(id)) {
        issues.push(`Replaced a duplicate chapter id (${id}).`);
        id = newId();
      }
      usedIds.add(id);

      const chapter = coerceChapter(raw, { id, parentId, newId, issues });
      if (!chapter) continue;

      byId[id] = chapter;
      childIds.push(id);
      if (Array.isArray(raw.children) && raw.children.length) {
        const descendants = visit(raw.children, id);
        byId[id] = { ...byId[id], childIds: descendants };
      }
    }
    return childIds;
  };

  const rootIds = visit(rawChapters, null);
  return {
    document: cleanupDocument({ byId, rootIds }, { issues }),
    issues,
  };
}

/**
 * Rebuild reachability from `rootIds` and `childIds`, dropping cycles, orphans
 * and duplicate references.
 *
 * @param {unknown} raw
 * @param {{ newId: () => string, issues: string[] }} context
 * @returns {{ document: ChapterDocument, issues: string[] }}
 */
function normalizeNormalized(raw, context) {
  const { newId, issues } = context;
  const source =
    /** @type {{ byId: Record<string, unknown>, rootIds: unknown[] }} */ (raw);
  const rawById = source.byId;
  /** @type {Record<string, Chapter>} */
  const byId = {};
  const usedIds = new Set();

  for (const [key, value] of Object.entries(rawById)) {
    if (!isRecord(value)) {
      issues.push(`Skipped a chapter record that is not an object (${key}).`);
      continue;
    }
    let id = isString(value.id) && value.id ? value.id : key;
    if (usedIds.has(id)) {
      issues.push(`Replaced a duplicate chapter id (${id}).`);
      id = newId();
    }
    usedIds.add(id);
    const chapter = coerceChapter(value, {
      id,
      parentId: null,
      newId,
      issues,
    });
    if (!chapter) continue;
    chapter.childIds = Array.isArray(value.childIds)
      ? value.childIds.filter(isString)
      : [];
    byId[id] = chapter;
  }

  /** @type {string[]} */
  const rootIds = [];
  const visited = new Set();

  /** @param {string} id @param {string|null} parentId @param {string[]} target @returns {boolean} */
  const attach = (id, parentId, target) => {
    const chapter = byId[id];
    if (!chapter) {
      issues.push(`Dropped a reference to a missing chapter (${id}).`);
      return false;
    }
    if (visited.has(id)) {
      issues.push(`Dropped a duplicate or cyclic chapter reference (${id}).`);
      return false;
    }
    visited.add(id);
    byId[id] = { ...chapter, parentId };
    target.push(id);

    /** @type {string[]} */
    const childIds = [];
    for (const childId of chapter.childIds) attach(childId, id, childIds);
    byId[id] = { ...byId[id], childIds };
    return true;
  };

  for (const id of source.rootIds.filter(isString)) attach(id, null, rootIds);

  for (const id of Object.keys(byId)) {
    if (visited.has(id)) continue;
    issues.push(
      `Recovered a chapter that was not reachable from the root (${id}).`,
    );
    attach(id, null, rootIds);
  }

  return {
    document: cleanupDocument({ byId, rootIds }, { issues }),
    issues,
  };
}

/**
 * Final consistency pass: parent ids, criterion links and empty criteria.
 *
 * @param {ChapterDocument} document
 * @param {{ issues: string[] }} context
 * @returns {ChapterDocument}
 */
function cleanupDocument(document, { issues }) {
  /** @type {Record<string, Chapter>} */
  const byId = {};
  for (const [id, chapter] of Object.entries(document.byId)) {
    const children = chapter.childIds.filter(
      (childId) => childId !== id && Boolean(document.byId[childId]),
    );
    const criteria = chapter.criteria.map((criterion) => {
      if (!criterion.chapterId || document.byId[criterion.chapterId]) {
        return criterion;
      }
      const { chapterId: _chapterId, ...rest } = criterion;
      return rest;
    });
    byId[id] = { ...chapter, childIds: children, criteria };
  }

  const rootIds = document.rootIds.filter((id) => byId[id]);
  for (const id of Object.keys(byId)) {
    if (rootIds.includes(id)) continue;
    const parent = byId[id].parentId;
    if (!parent || !byId[parent]) {
      issues.push(`Kept a chapter without a parent at the root (${id}).`);
      rootIds.push(id);
      byId[id] = { ...byId[id], parentId: null };
    }
  }

  return { byId, rootIds };
}

/**
 * @param {unknown} raw
 * @param {{ now?: () => string, newId?: () => string }} [options]
 * @returns {{ events: ActivityEntry[], issues: string[] }}
 */
export function normalizeActivity(raw, options = {}) {
  const now = options.now ?? (() => new Date().toISOString());
  const newId = options.newId ?? createId;
  /** @type {string[]} */
  const issues = [];

  if (raw == null) return { events: [], issues };
  const input = Array.isArray(raw)
    ? raw
    : isRecord(raw) && Array.isArray(raw.events)
      ? raw.events
      : isRecord(raw) && Array.isArray(raw.items)
        ? raw.items
        : null;

  if (!input) {
    issues.push("The saved activity history was not a list.");
    return { events: [], issues };
  }

  /** @type {ActivityEntry[]} */
  const events = [];
  const usedIds = new Set();

  for (const item of input) {
    if (!isRecord(item)) {
      issues.push("Skipped an activity entry that is not an object.");
      continue;
    }
    if (!isString(item.message) || !item.message.trim()) {
      issues.push("Skipped an activity entry without a message.");
      continue;
    }
    let id = isString(item.id) && item.id ? item.id : newId();
    if (usedIds.has(id)) {
      issues.push(`Replaced a duplicate activity id (${id}).`);
      id = newId();
    }
    usedIds.add(id);

    const time =
      isString(item.time) && !Number.isNaN(Date.parse(item.time))
        ? new Date(item.time).toISOString()
        : now();

    events.push({
      id,
      message: item.message,
      chapterId: isString(item.chapterId) ? item.chapterId : null,
      chapterName:
        isString(item.chapterName) && item.chapterName
          ? item.chapterName
          : "Untitled chapter",
      time,
    });
  }

  return { events: events.slice(0, MAX_ACTIVITY_ENTRIES), issues };
}

/**
 * Normalize a complete workspace payload (legacy or new split format).
 *
 * @param {unknown} raw
 * @param {{ now?: () => string, newId?: () => string }} [options]
 * @returns {{ workspace: Workspace, issues: string[] }}
 */
export function normalizeWorkspace(raw, options = {}) {
  const input = isRecord(raw) ? raw : {};
  const { document, issues } = normalizeDocument(input, options);
  const activity = normalizeActivity(input.events, options);
  issues.push(...activity.issues);
  const selectedId =
    isString(input.selectedId) && document.byId[input.selectedId]
      ? input.selectedId
      : getDefaultId(document, null);

  return {
    workspace: createWorkspace({
      project: input.project,
      chapters: document,
      events: activity.events,
      selectedId,
    }),
    issues,
  };
}

/**
 * @returns {Workspace}
 */
export function createSampleWorkspace() {
  const { document } = normalizeDocument(initialChapters);
  return createWorkspace({
    chapters: document,
    selectedId: "password-reset",
  });
}

/**
 * @param {Workspace} workspace
 */
export function serializeDocument(workspace) {
  return {
    schemaVersion: SCHEMA_VERSION,
    project: workspace.project,
    chapters: workspace.chapters,
  };
}

/**
 * @param {Workspace} workspace
 */
export function serializeActivity(workspace) {
  return { schemaVersion: SCHEMA_VERSION, events: workspace.events };
}

/**
 * @param {Workspace} workspace
 */
export function serializeUi(workspace) {
  return { schemaVersion: SCHEMA_VERSION, selectedId: workspace.selectedId };
}
