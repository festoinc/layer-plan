import { initialChapters } from "../data";
import {
  Chapter,
  ChapterDocument,
  createEmptyDocument,
  Criterion,
  getDefaultId,
} from "./chapters";
import { ActivityEntry, MAX_ACTIVITY_ENTRIES } from "./activity";

export type { Chapter, Criterion, ChapterDocument, ActivityEntry };

export const SCHEMA_VERSION = 3;

export interface Project {
  id: string;
  name: string;
  account: string;
}

export const SAMPLE_PROJECT: Project = {
  id: "website",
  name: "Website project",
  account: "W",
};

export interface Workspace {
  schemaVersion: number;
  project: Project;
  chapters: ChapterDocument;
  events: ActivityEntry[];
  selectedId: string | null;
}

const isRecord = (value: unknown): value is Record<string, any> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isString = (value: unknown): value is string => typeof value === "string";

export function createId(): string {
  if (
    typeof globalThis.crypto !== "undefined" &&
    typeof globalThis.crypto.randomUUID === "function"
  ) {
    return globalThis.crypto.randomUUID();
  }
  return `id-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function createProject(input: unknown = {}): Project {
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

export function createWorkspace(input: Partial<Workspace> = {}): Workspace {
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
 */
function coerceChapter(
  raw: unknown,
  {
    id,
    parentId,
    newId,
    issues,
  }: {
    id: string;
    parentId: string | null;
    newId: () => string;
    issues: string[];
  },
): Chapter | null {
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

function normalizeCriteria(
  raw: unknown,
  { newId, issues }: { newId: () => string; issues: string[] },
): Criterion[] {
  if (raw == null) return [];
  if (!Array.isArray(raw)) {
    issues.push("Replaced a criterion list that was not an array.");
    return [];
  }

  const criteria: Criterion[] = [];
  const usedIds = new Set<string>();

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

    const criterion: Criterion = {
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

export interface NormalizeOptions {
  newId?: () => string;
  now?: () => string;
}

/**
 * Accepts either a normalized document, a nested phase 1 chapter array, or a
 * payload wrapper containing `chapters`.
 */
export function normalizeDocument(
  raw: unknown,
  options: NormalizeOptions = {},
): { document: ChapterDocument; issues: string[] } {
  const newId = options.newId ?? createId;
  const issues: string[] = [];
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
 */
function normalizeNested(
  rawChapters: unknown[],
  context: { newId: () => string; issues: string[] },
): { document: ChapterDocument; issues: string[] } {
  const { newId, issues } = context;
  const byId: Record<string, Chapter> = {};
  const usedIds = new Set<string>();

  const visit = (list: unknown[], parentId: string | null): string[] => {
    const childIds: string[] = [];
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
 */
function normalizeNormalized(
  raw: unknown,
  context: { newId: () => string; issues: string[] },
): { document: ChapterDocument; issues: string[] } {
  const { newId, issues } = context;
  const source = raw as { byId: Record<string, unknown>; rootIds: unknown[] };
  const rawById = source.byId;
  const byId: Record<string, Chapter> = {};
  const usedIds = new Set<string>();

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

  const rootIds: string[] = [];
  const visited = new Set<string>();

  const attach = (
    id: string,
    parentId: string | null,
    target: string[],
  ): boolean => {
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

    const childIds: string[] = [];
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
 */
function cleanupDocument(
  document: ChapterDocument,
  { issues }: { issues: string[] },
): ChapterDocument {
  const byId: Record<string, Chapter> = {};
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

export function normalizeActivity(
  raw: unknown,
  options: NormalizeOptions = {},
): { events: ActivityEntry[]; issues: string[] } {
  const now = options.now ?? (() => new Date().toISOString());
  const newId = options.newId ?? createId;
  const issues: string[] = [];

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

  const events: ActivityEntry[] = [];
  const usedIds = new Set<string>();

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
 */
export function normalizeWorkspace(
  raw: unknown,
  options: NormalizeOptions = {},
): { workspace: Workspace; issues: string[] } {
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

export function createSampleWorkspace(): Workspace {
  const { document } = normalizeDocument(initialChapters);
  return createWorkspace({
    chapters: document,
    selectedId: "password-reset",
  });
}

export function serializeDocument(workspace: Workspace): {
  schemaVersion: number;
  project: Project;
  chapters: ChapterDocument;
} {
  return {
    schemaVersion: SCHEMA_VERSION,
    project: workspace.project,
    chapters: workspace.chapters,
  };
}

export function serializeActivity(workspace: Workspace): {
  schemaVersion: number;
  events: ActivityEntry[];
} {
  return { schemaVersion: SCHEMA_VERSION, events: workspace.events };
}

export function serializeUi(workspace: Workspace): {
  schemaVersion: number;
  selectedId: string | null;
} {
  return { schemaVersion: SCHEMA_VERSION, selectedId: workspace.selectedId };
}
