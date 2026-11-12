import { initialChapters } from "../data";
import {
  Chapter,
  ChapterDocument,
  createEmptyDocument,
  Criterion,
  getDefaultId,
} from "./chapters";
import { ActivityEntry, MAX_ACTIVITY_ENTRIES } from "./activity";
import {
  createId,
  MAX_PROJECTS,
  normalizeProject,
  Project,
  ProjectSummary,
} from "./projects";
import {
  hasVerificationContent,
  normalizeVerification,
} from "./verificationTypes";

export type { Chapter, Criterion, ChapterDocument, ActivityEntry };
export type { Project, ProjectSummary };
export { createId };

export const SCHEMA_VERSION = 6;

export interface Workspace {
  schemaVersion: number;
  projectId: string;
  chapters: ChapterDocument;
  events: ActivityEntry[];
  selectedId: string | null;
}

export interface ProjectIndex {
  schemaVersion: number;
  activeProjectId: string | null;
  projectIds: string[];
  projects: Record<string, ProjectSummary>;
}

export const MAX_TEST_GUIDELINES = 8000;

export interface ProjectSettings {
  schemaVersion: number;
  projectId: string;
  testGuidelines: string;
}

export function normalizeTestGuidelines(value: unknown): string {
  return isString(value)
    ? value.replace(/\r\n/g, "\n").trim().slice(0, MAX_TEST_GUIDELINES)
    : "";
}

export function createProjectSettings(
  projectId: string,
  testGuidelines = "",
): ProjectSettings {
  return {
    schemaVersion: SCHEMA_VERSION,
    projectId,
    testGuidelines: normalizeTestGuidelines(testGuidelines),
  };
}

export function serializeProjectSettings(settings: ProjectSettings): {
  schemaVersion: number;
  projectId: string;
  testGuidelines: string;
} {
  return {
    schemaVersion: SCHEMA_VERSION,
    projectId: settings.projectId,
    testGuidelines: settings.testGuidelines,
  };
}

export const PROJECT_EXPORT_FORMAT = "layers-project";
export const PROJECT_EXPORT_VERSION = 3;

export const PROJECT_EXPORT_INSTRUCTIONS = [
  "# Layers project export",
  "",
  "This file is a complete export of one Layers project. It is not a generic",
  "document dump and it is safe to read programmatically.",
  "",
  "## Top-level fields",
  "",
  '- format: always "layers-project".',
  "- formatVersion: the export format version.",
  "- exportedAt: ISO timestamp for this export.",
  "- instructions: this guide, repeated in every export for AI agents.",
  "- project: project id, name, initials, colour, description and timestamps.",
  "- testGuidelines: shared instructions for human and AI testers.",
  "- chapters: the normalized chapter tree (see below).",
  "- activity: newest-first project activity, capped at 100 entries.",
  "- ui.selectedId: the chapter that was selected when the project was exported.",
  "",
  "## Reading chapters",
  "",
  "- chapters.byId maps chapter ids to chapter records.",
  "- chapters.rootIds lists top-level chapters in display order.",
  "- Each chapter has id, parentId, title, description, finalLevel,",
  "  verification, criteria and childIds.",
  "- criteria are checklist items with id, text and checked. A criterion may",
  "  also have chapterId when it created a subchapter.",
  "- Markdown is used in descriptions and criterion text.",
  "",
  "## Verification rules",
  "",
  '- Each chapter has one verification rule with mode "auto", "human" or',
  '  "ai".',
  "- auto.command is one command for automated verification.",
  "- human.instructions and ai.instructions are plain text.",
  "- Only non-root chapters are verification-eligible. Coverage counts only",
  "  auto chapters with a non-empty command.",
  "",
  "## Importing",
  "",
  "Send this JSON document to POST /api/v1/projects/import. An import always",
  "creates a new project and never overwrites or merges into an existing one.",
  'Name collisions receive an "(imported)" suffix.',
  "",
  "For live changes, read the project document from",
  "GET /api/v1/projects/<projectId>/document and write it back with",
  "PUT /api/v1/projects/<projectId>/document using If-Match. Do not edit the",
  "SQLite database directly.",
].join("\n");

export interface ProjectExport {
  format: typeof PROJECT_EXPORT_FORMAT;
  formatVersion: number;
  exportedAt: string;
  instructions: string;
  project: Project;
  testGuidelines: string;
  chapters: ChapterDocument;
  activity: ActivityEntry[];
  ui: { selectedId: string | null };
}

const isRecord = (value: unknown): value is Record<string, any> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isString = (value: unknown): value is string => typeof value === "string";

export function createEmptyProjectIndex(): ProjectIndex {
  return {
    schemaVersion: SCHEMA_VERSION,
    activeProjectId: null,
    projectIds: [],
    projects: {},
  };
}

function normalizeStats(raw: unknown): {
  chapterCount: number;
  criterionCount: number;
  checkedCount: number;
} {
  const source = isRecord(raw) ? raw : {};
  const count = (value: unknown) =>
    typeof value === "number" && Number.isFinite(value) && value >= 0
      ? Math.floor(value)
      : 0;
  return {
    chapterCount: count(source.chapterCount),
    criterionCount: count(source.criterionCount),
    checkedCount: count(source.checkedCount),
  };
}

/**
 * Repair a project catalog. Missing ids, duplicate entries, stale active ids
 * and invalid metadata are corrected without touching project documents.
 */
export function normalizeProjectIndex(
  raw: unknown,
  options: NormalizeOptions = {},
): { index: ProjectIndex; issues: string[] } {
  const newId = options.newId ?? createId;
  const now = options.now ?? (() => new Date().toISOString());
  const issues: string[] = [];

  if (!isRecord(raw)) {
    if (raw != null) issues.push("The project catalog was not an object.");
    return { index: createEmptyProjectIndex(), issues };
  }

  const rawProjects = isRecord(raw.projects) ? raw.projects : {};
  if (raw.projects != null && !isRecord(raw.projects)) {
    issues.push("The project catalog did not contain usable project entries.");
  }

  const projects: Record<string, ProjectSummary> = {};
  const discovered: string[] = [];
  for (const [key, value] of Object.entries(rawProjects)) {
    const project = normalizeProject(value, { id: key, newId, now });
    if (projects[project.id]) {
      issues.push(`Replaced a duplicate project id (${project.id}).`);
      const replacementId = newId();
      projects[replacementId] = {
        ...project,
        id: replacementId,
        ...normalizeStats(value),
      };
      discovered.push(replacementId);
      continue;
    }
    projects[project.id] = {
      ...project,
      ...normalizeStats(value),
    };
    discovered.push(project.id);
  }

  const requestedOrder = Array.isArray(raw.projectIds)
    ? raw.projectIds.filter(isString)
    : [];
  const projectIds: string[] = [];
  for (const id of requestedOrder) {
    if (!projects[id]) {
      issues.push(`Dropped a reference to a missing project (${id}).`);
      continue;
    }
    if (projectIds.includes(id)) continue;
    projectIds.push(id);
  }
  for (const id of discovered) {
    if (!projectIds.includes(id)) projectIds.push(id);
  }

  if (projectIds.length > MAX_PROJECTS) {
    issues.push(
      `Kept the first ${MAX_PROJECTS} projects from the saved catalog.`,
    );
    for (const id of projectIds.slice(MAX_PROJECTS)) delete projects[id];
    projectIds.length = MAX_PROJECTS;
  }

  const requestedActive = isString(raw.activeProjectId)
    ? raw.activeProjectId
    : null;
  const activeProjectId =
    requestedActive && projects[requestedActive]
      ? requestedActive
      : (projectIds[0] ?? null);
  if (requestedActive && !projects[requestedActive]) {
    issues.push("The active project was missing; selected the first project.");
  }

  return {
    index: {
      schemaVersion: SCHEMA_VERSION,
      activeProjectId,
      projectIds,
      projects,
    },
    issues,
  };
}

export function createWorkspace(
  input: Partial<Workspace> & { projectId?: string } = {},
): Workspace {
  const chapters = input.chapters ?? createEmptyDocument();
  return {
    schemaVersion: SCHEMA_VERSION,
    projectId: input.projectId ?? "",
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
  const verificationSource =
    raw.verification ?? legacyCriterionVerification(raw.criteria);

  return {
    id,
    parentId,
    title,
    description: isString(raw.description) ? raw.description : "",
    finalLevel: raw.finalLevel === true,
    verification: normalizeVerification(verificationSource),
    criteria,
    childIds: [],
  };
}

/**
 * Phase 4 stored verification on each criterion. Phase 5 moves it to the
 * chapter; keep the first non-empty rule so old v5 data upgrades in place.
 */
function legacyCriterionVerification(rawCriteria: unknown): unknown {
  if (!Array.isArray(rawCriteria)) return undefined;
  for (const item of rawCriteria) {
    if (!isRecord(item) || !isRecord(item.verification)) continue;
    const normalized = normalizeVerification(item.verification);
    if (hasVerificationContent(normalized)) return item.verification;
  }
  return undefined;
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
 * Normalize a complete project workspace payload.
 */
export function normalizeWorkspace(
  raw: unknown,
  options: NormalizeOptions & { projectId?: string } = {},
): { workspace: Workspace; issues: string[] } {
  const input = isRecord(raw) ? raw : {};
  const { document, issues } = normalizeDocument(input, options);
  const activitySource =
    input.events ?? (isRecord(input) ? input.activity : undefined);
  const activity = normalizeActivity(activitySource, options);
  issues.push(...activity.issues);
  const selectedId =
    isString(input.selectedId) && document.byId[input.selectedId]
      ? input.selectedId
      : getDefaultId(document, null);
  const projectId =
    options.projectId ??
    (isString(input.projectId)
      ? input.projectId
      : isRecord(input.project) && isString(input.project.id)
        ? input.project.id
        : "");

  return {
    workspace: createWorkspace({
      projectId,
      chapters: document,
      events: activity.events,
      selectedId,
    }),
    issues,
  };
}

export function createSampleWorkspace(projectId = "website"): Workspace {
  const { document } = normalizeDocument(initialChapters);
  return createWorkspace({
    projectId,
    chapters: document,
    selectedId: "password-reset",
  });
}

export interface ImportedProject {
  project: Project;
  testGuidelines: string;
  workspace: Workspace;
  issues: string[];
}

/**
 * Accept a `layers-project` export, a phase 1/2 workspace export, a bare
 * normalized document or a nested phase 1 chapter array.
 */
export function normalizeProjectExport(
  raw: unknown,
  options: NormalizeOptions = {},
): ImportedProject {
  const newId = options.newId ?? createId;
  const now = options.now ?? (() => new Date().toISOString());
  const input = isRecord(raw) ? raw : {};

  let chaptersRaw: unknown = input.chapters;
  let activityRaw: unknown = input.activity ?? input.events;
  let projectRaw: unknown = input.project;
  let selectedRaw: unknown = input.selectedId;
  const testGuidelinesRaw: unknown =
    input.testGuidelines ??
    (isRecord(input.project) ? input.project.testGuidelines : undefined);

  if (Array.isArray(raw)) {
    chaptersRaw = raw;
    activityRaw = undefined;
    projectRaw = undefined;
  } else if (isRecord(raw)) {
    if (raw.format === PROJECT_EXPORT_FORMAT) {
      chaptersRaw = raw.chapters;
      activityRaw = raw.activity ?? raw.events;
      selectedRaw = isRecord(raw.ui) ? raw.ui.selectedId : raw.selectedId;
    } else if ("chapters" in raw) {
      chaptersRaw = raw.chapters;
      activityRaw = raw.events ?? raw.activity;
      selectedRaw =
        raw.selectedId ?? (isRecord(raw.ui) ? raw.ui.selectedId : null);
    } else if ("byId" in raw && "rootIds" in raw) {
      chaptersRaw = raw;
    }
  }

  const issues: string[] = [];
  const { document, issues: documentIssues } = normalizeDocument(chaptersRaw, {
    newId,
  });
  issues.push(...documentIssues);
  const activity = normalizeActivity(activityRaw, { newId, now });
  issues.push(...activity.issues);

  const project = normalizeProject(projectRaw, { newId, now });
  const workspace = createWorkspace({
    projectId: project.id,
    chapters: document,
    events: activity.events,
    selectedId: isString(selectedRaw) ? selectedRaw : null,
  });

  return {
    project,
    testGuidelines: normalizeTestGuidelines(testGuidelinesRaw),
    workspace,
    issues,
  };
}

export function serializeProjectExport(
  project: Project,
  workspace: Workspace,
  testGuidelines: string,
  exportedAt: string,
): ProjectExport {
  return {
    format: PROJECT_EXPORT_FORMAT,
    formatVersion: PROJECT_EXPORT_VERSION,
    exportedAt,
    instructions: PROJECT_EXPORT_INSTRUCTIONS,
    project,
    testGuidelines: normalizeTestGuidelines(testGuidelines),
    chapters: workspace.chapters,
    activity: workspace.events,
    ui: { selectedId: workspace.selectedId },
  };
}

export function serializeDocument(workspace: Workspace): {
  schemaVersion: number;
  projectId: string;
  chapters: ChapterDocument;
} {
  return {
    schemaVersion: SCHEMA_VERSION,
    projectId: workspace.projectId,
    chapters: workspace.chapters,
  };
}

export function serializeActivity(workspace: Workspace): {
  schemaVersion: number;
  projectId: string;
  events: ActivityEntry[];
} {
  return {
    schemaVersion: SCHEMA_VERSION,
    projectId: workspace.projectId,
    events: workspace.events,
  };
}

export function serializeUi(workspace: Workspace): {
  schemaVersion: number;
  projectId: string;
  selectedId: string | null;
} {
  return {
    schemaVersion: SCHEMA_VERSION,
    projectId: workspace.projectId,
    selectedId: workspace.selectedId,
  };
}
