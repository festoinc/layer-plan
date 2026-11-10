import { ChapterDocument, walkChapters } from "./chapters";

export const MAX_PROJECTS = 9999;

export const PROJECT_COLORS = [
  "indigo",
  "teal",
  "amber",
  "rose",
  "violet",
  "emerald",
  "sky",
  "slate",
] as const;

export type ProjectColor = (typeof PROJECT_COLORS)[number];

export const DEFAULT_PROJECT_COLOR: ProjectColor = "indigo";

export interface Project {
  id: string;
  name: string;
  initials: string;
  color: ProjectColor;
  description: string;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectSummary extends Project {
  chapterCount: number;
  criterionCount: number;
  checkedCount: number;
}

export interface ProjectStats {
  chapterCount: number;
  criterionCount: number;
  checkedCount: number;
}

export interface ProjectInput {
  name: string;
  initials?: string;
  color?: ProjectColor;
  description?: string;
  testGuidelines?: string;
}

export interface ProjectPatch {
  name?: string;
  initials?: string;
  color?: ProjectColor;
  description?: string;
  testGuidelines?: string;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isString = (value: unknown): value is string => typeof value === "string";

const PROJECT_ID_PATTERN = /^[a-zA-Z0-9_-]{1,64}$/;

export function createId(): string {
  if (
    typeof globalThis.crypto !== "undefined" &&
    typeof globalThis.crypto.randomUUID === "function"
  ) {
    return globalThis.crypto.randomUUID();
  }
  return `id-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function isSafeProjectId(value: unknown): value is string {
  return isString(value) && PROJECT_ID_PATTERN.test(value);
}

export function deriveInitials(name: string): string {
  const words = String(name ?? "")
    .trim()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);
  const letters = words
    .slice(0, 2)
    .map((word) => word[0])
    .join("")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
  return letters.slice(0, 2) || "P";
}

export function normalizeInitials(value: unknown, name: string): string {
  const initials = isString(value)
    ? value
        .trim()
        .toUpperCase()
        .replace(/[^A-Z0-9]/g, "")
        .slice(0, 2)
    : "";
  return initials || deriveInitials(name);
}

export function normalizeProjectColor(value: unknown): ProjectColor {
  return PROJECT_COLORS.includes(value as ProjectColor)
    ? (value as ProjectColor)
    : DEFAULT_PROJECT_COLOR;
}

function normalizeTimestamp(value: unknown, fallback: string): string {
  return isString(value) && !Number.isNaN(Date.parse(value))
    ? new Date(value).toISOString()
    : fallback;
}

export interface NormalizeProjectOptions {
  id?: string;
  newId?: () => string;
  now?: () => string;
}

export function normalizeProject(
  raw: unknown,
  options: NormalizeProjectOptions = {},
): Project {
  const newId = options.newId ?? createId;
  const now = options.now ?? (() => new Date().toISOString());
  const source = isRecord(raw) ? raw : {};
  const timestamp = now();

  const rawId = isString(source.id) ? source.id : "";
  const id = isSafeProjectId(options.id)
    ? options.id
    : isSafeProjectId(rawId)
      ? rawId
      : newId();

  const rawName = isString(source.name) ? source.name.trim() : "";
  const name = (rawName || "Untitled project").slice(0, 80);
  const rawDescription = isString(source.description)
    ? source.description.trim()
    : "";
  const createdAt = normalizeTimestamp(source.createdAt, timestamp);
  let updatedAt = normalizeTimestamp(source.updatedAt, timestamp);
  if (Date.parse(updatedAt) < Date.parse(createdAt)) updatedAt = createdAt;

  return {
    id,
    name,
    initials: normalizeInitials(source.initials ?? source.account, name),
    color: normalizeProjectColor(source.color),
    description: rawDescription.slice(0, 280),
    createdAt,
    updatedAt,
  };
}

export function createProjectRecord(
  input: ProjectInput,
  options: NormalizeProjectOptions = {},
): Project {
  return normalizeProject(input, options);
}

export function summarizeDocument(document: ChapterDocument): ProjectStats {
  const chapters = walkChapters(document);
  let criterionCount = 0;
  let checkedCount = 0;
  for (const chapter of chapters) {
    criterionCount += chapter.criteria.length;
    checkedCount += chapter.criteria.filter(
      (criterion) => criterion.checked,
    ).length;
  }
  return {
    chapterCount: chapters.length,
    criterionCount,
    checkedCount,
  };
}

export function summarizeProject(
  project: Project,
  document: ChapterDocument,
): ProjectSummary {
  return { ...project, ...summarizeDocument(document) };
}

export function sortProjects(
  projects: ProjectSummary[],
  activeProjectId: string | null,
): ProjectSummary[] {
  return [...projects].sort((first, second) => {
    if (first.id === activeProjectId) return -1;
    if (second.id === activeProjectId) return 1;
    const byUpdate = Date.parse(second.updatedAt) - Date.parse(first.updatedAt);
    if (byUpdate !== 0) return byUpdate;
    return first.name.localeCompare(second.name);
  });
}

export function uniqueProjectName(
  base: string,
  existingNames: Iterable<string>,
  options: { suffix?: string } = {},
): string {
  const trimmed = base.trim().slice(0, 80) || "Untitled project";
  const names = new Set(
    Array.from(existingNames, (name) => name.trim().toLowerCase()),
  );
  const suffix = options.suffix ?? "";
  const candidate = `${trimmed}${suffix}`.slice(0, 80);
  if (!names.has(candidate.toLowerCase())) return candidate;

  for (let index = 2; index < 10000; index += 1) {
    const numbered = `${trimmed}${suffix} ${index}`.slice(0, 80);
    if (!names.has(numbered.toLowerCase())) return numbered;
  }
  return `${trimmed}${suffix} ${createId().slice(0, 4)}`.slice(0, 80);
}
