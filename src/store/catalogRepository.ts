import { sampleProjects } from "../data";
import { appendActivity, createActivityEntry } from "../domain/activity";
import { ChapterDocument, createChapter } from "../domain/chapters";
import {
  createProjectRecord,
  MAX_PROJECTS,
  normalizeProject,
  Project,
  ProjectInput,
  ProjectPatch,
  ProjectSummary,
  sortProjects,
  summarizeDocument,
  summarizeProject,
  uniqueProjectName,
} from "../domain/projects";
import {
  createEmptyProjectIndex,
  createId,
  createWorkspace,
  normalizeActivity,
  normalizeDocument,
  normalizeProjectExport,
  normalizeProjectIndex,
  ProjectIndex,
  SCHEMA_VERSION,
  serializeActivity,
  serializeDocument,
  serializeProjectExport,
  serializeUi,
  Workspace,
} from "../domain/schema";
import {
  ChangedSlices,
  createProjectRepository,
  listStorageKeys,
  ProjectRepository,
  projectKeys,
  readJson,
  RepositoryStatus,
  resolveStorage,
  STORAGE_KEYS,
  STORAGE_STATUS,
  StorageNotice,
  StorageStatusState,
  backupValue,
} from "./persistence";

export type CatalogResult<T> =
  { ok: true; value: T; issues: string[] } | { ok: false; issues: string[] };

export interface DeleteProjectResult {
  activeProjectId: string | null;
}

export interface CatalogRepository {
  load: () => { index: ProjectIndex; notices: StorageNotice[] };
  listProjects: () => ProjectSummary[];
  getProject: (id: string) => ProjectSummary | null;
  getActiveProjectId: () => string | null;
  setActiveProject: (id: string) => boolean;
  createProject: (input: ProjectInput) => CatalogResult<ProjectSummary>;
  updateProject: (
    id: string,
    patch: ProjectPatch,
  ) => CatalogResult<ProjectSummary>;
  duplicateProject: (id: string) => CatalogResult<ProjectSummary>;
  deleteProject: (id: string) => CatalogResult<DeleteProjectResult>;
  importProject: (text: string) => CatalogResult<ProjectSummary>;
  exportProject: (id: string, workspace?: Workspace) => string | null;
  createProjectRepository: (id: string) => ProjectRepository;
  subscribe: (listener: () => void) => () => void;
  handleStorageEvent: (event: { key?: string | null }) => void;
  status: () => RepositoryStatus;
  onStatusChange: (listener: (status: RepositoryStatus) => void) => () => void;
  retry: () => void;
  dispose: () => void;
}

export interface CreateCatalogRepositoryOptions {
  storage?: Storage;
  debounceMs?: number;
  windowObject?: (Window & typeof globalThis) | null;
  now?: () => string;
  newId?: () => string;
}

function isRecord(value: unknown): value is Record<string, any> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function describeIssues(issues: string[]): StorageNotice[] {
  return [
    {
      level: "warning",
      message: `Some saved project data was repaired: ${issues
        .slice(0, 3)
        .join(" ")}${issues.length > 3 ? ` (+${issues.length - 3} more)` : ""}`,
    },
  ];
}

export function createCatalogRepository(
  options: CreateCatalogRepositoryOptions = {},
): CatalogRepository {
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

  let index: ProjectIndex = createEmptyProjectIndex();
  let currentStatus: RepositoryStatus = {
    state: available ? STORAGE_STATUS.saved : STORAGE_STATUS.unavailable,
    message: available
      ? "Project list saved in this browser."
      : "Browser storage is unavailable. Projects stay in this tab.",
  };
  const statusListeners = new Set<(status: RepositoryStatus) => void>();
  const indexListeners = new Set<() => void>();

  function setStatus(state: StorageStatusState, message: string) {
    if (currentStatus.state === state && currentStatus.message === message) {
      return;
    }
    currentStatus = { state, message };
    for (const listener of statusListeners) listener(currentStatus);
  }

  function notify() {
    for (const listener of indexListeners) listener();
  }

  function storedIndex(): ProjectIndex {
    const result = readJson(storage, STORAGE_KEYS.index);
    if (result.status !== "ok") return index;
    const normalized = normalizeProjectIndex(result.value, { newId, now });
    return normalized.index;
  }

  function writeIndex(next: ProjectIndex): boolean {
    try {
      storage.setItem(STORAGE_KEYS.index, JSON.stringify(next));
      index = next;
      return true;
    } catch (error) {
      setStatus(
        STORAGE_STATUS.error,
        error instanceof Error
          ? `The project list could not be saved: ${error.message}`
          : "The project list could not be saved.",
      );
      return false;
    }
  }

  function writeProjectPayload(id: string, workspace: Workspace): boolean {
    const keys = projectKeys(id);
    try {
      storage.setItem(
        keys.document,
        JSON.stringify(serializeDocument(workspace)),
      );
      storage.setItem(
        keys.activity,
        JSON.stringify(serializeActivity(workspace)),
      );
      storage.setItem(keys.ui, JSON.stringify(serializeUi(workspace)));
      return true;
    } catch (error) {
      setStatus(
        STORAGE_STATUS.error,
        error instanceof Error
          ? `The project could not be saved: ${error.message}`
          : "The project could not be saved.",
      );
      return false;
    }
  }

  function removeProjectPayload(id: string) {
    const keys = projectKeys(id);
    for (const key of [keys.document, keys.activity, keys.ui]) {
      try {
        storage.removeItem(key);
      } catch {
        // The index no longer references this project, so an orphan key is safe.
      }
    }
  }

  function writeProjectActivity(
    id: string,
    message: string,
    chapterName: string,
  ): boolean {
    const key = projectKeys(id).activity;
    const result = readJson(storage, key);
    const normalized = normalizeActivity(
      result.status === "ok" ? (result.value?.events ?? result.value) : [],
      { newId, now },
    );
    const entry = createActivityEntry({
      id: newId(),
      message,
      chapterId: null,
      chapterName,
      time: now(),
    });
    try {
      storage.setItem(
        key,
        JSON.stringify({
          schemaVersion: SCHEMA_VERSION,
          projectId: id,
          events: appendActivity(normalized.events, entry),
        }),
      );
      return true;
    } catch {
      return false;
    }
  }

  function seedCatalog(notices: StorageNotice[]) {
    const removable = listStorageKeys(storage).filter(
      (key) =>
        key.startsWith(STORAGE_KEYS.projectPrefix) ||
        STORAGE_KEYS.legacy.includes(key),
    );
    for (const key of removable) {
      try {
        storage.removeItem(key);
      } catch {
        // Best effort.
      }
    }

    const next = createEmptyProjectIndex();
    for (const sample of sampleProjects) {
      const project = createProjectRecord(sample.project, {
        id: sample.project.id,
        newId,
        now,
      });
      const { document } = normalizeDocument(sample.chapters, { newId });
      const workspace = createWorkspace({
        projectId: project.id,
        chapters: document,
        events: [],
        selectedId: sample.selectedId,
      });
      writeProjectPayload(project.id, workspace);
      next.projects[project.id] = summarizeProject(project, document);
      next.projectIds.push(project.id);
    }
    next.activeProjectId = next.projectIds[0] ?? null;
    index = next;
    writeIndex(next);
    notices.push({
      level: "info",
      message:
        "Multi-project storage initialised. Previous single-project data was cleared.",
    });
  }

  function load(): { index: ProjectIndex; notices: StorageNotice[] } {
    const notices: StorageNotice[] = [];
    const result = readJson(storage, STORAGE_KEYS.index);

    if (result.status === "ok") {
      const normalized = normalizeProjectIndex(result.value, { newId, now });
      index = normalized.index;
      if (normalized.issues.length) {
        if (!index.projectIds.length) {
          const backupKey = backupValue(
            storage,
            STORAGE_KEYS.index,
            result.raw,
            now,
          );
          notices.push({
            level: "warning",
            message:
              "The project list could not be read. A backup was kept and the sample projects were restored.",
            backupKey: backupKey ?? undefined,
          });
          seedCatalog(notices);
        } else {
          notices.push(...describeIssues(normalized.issues));
          writeIndex(index);
        }
      }
    } else if (result.status === "corrupt") {
      const backupKey = backupValue(
        storage,
        STORAGE_KEYS.index,
        result.raw,
        now,
      );
      notices.push({
        level: "warning",
        message:
          "The project list could not be read. A backup was kept and the sample projects were restored.",
        backupKey: backupKey ?? undefined,
      });
      seedCatalog(notices);
    } else {
      seedCatalog(notices);
    }

    if (!available) {
      setStatus(
        STORAGE_STATUS.unavailable,
        "Browser storage is unavailable. Projects stay in this tab.",
      );
    }
    return { index, notices };
  }

  function listProjects(): ProjectSummary[] {
    return sortProjects(Object.values(index.projects), index.activeProjectId);
  }

  function getProject(id: string): ProjectSummary | null {
    return index.projects[id] ?? null;
  }

  function setActiveProject(id: string): boolean {
    const current = storedIndex();
    if (!current.projects[id] || current.activeProjectId === id) {
      index = current;
      return Boolean(current.projects[id]);
    }
    const next = { ...current, activeProjectId: id };
    if (!writeIndex(next)) return false;
    notify();
    return true;
  }

  function createProject(input: ProjectInput): CatalogResult<ProjectSummary> {
    const current = storedIndex();
    if (current.projectIds.length >= MAX_PROJECTS) {
      return {
        ok: false,
        issues: [`The project limit is ${MAX_PROJECTS}.`],
      };
    }

    const id = newId();
    const project = createProjectRecord(input, { id, newId, now });
    const chapter = createChapter({ id: newId(), title: "Overview" });
    const chapters: ChapterDocument = {
      byId: { [chapter.id]: chapter },
      rootIds: [chapter.id],
    };
    const entry = createActivityEntry({
      id: newId(),
      message: "Created project",
      chapterId: chapter.id,
      chapterName: chapter.title,
      time: now(),
    });
    const workspace = createWorkspace({
      projectId: id,
      chapters,
      events: [entry],
      selectedId: chapter.id,
    });

    if (!writeProjectPayload(id, workspace)) {
      return { ok: false, issues: ["The project could not be saved."] };
    }

    const summary = summarizeProject(project, chapters);
    const next: ProjectIndex = {
      ...current,
      activeProjectId: id,
      projectIds: [...current.projectIds, id],
      projects: { ...current.projects, [id]: summary },
    };
    if (!writeIndex(next)) {
      removeProjectPayload(id);
      return { ok: false, issues: ["The project list could not be saved."] };
    }
    notify();
    return { ok: true, value: summary, issues: [] };
  }

  function updateProject(
    id: string,
    patch: ProjectPatch,
  ): CatalogResult<ProjectSummary> {
    const current = storedIndex();
    const existing = current.projects[id];
    if (!existing) {
      return { ok: false, issues: ["The project no longer exists."] };
    }
    if (patch.name !== undefined && !patch.name.trim()) {
      return { ok: false, issues: ["A project name is required."] };
    }

    const project = normalizeProject(
      { ...existing, ...patch, id, updatedAt: now() },
      { id, newId, now },
    );
    const summary = { ...existing, ...project };
    const next: ProjectIndex = {
      ...current,
      projects: { ...current.projects, [id]: summary },
    };
    if (!writeIndex(next)) {
      return { ok: false, issues: ["The project list could not be saved."] };
    }

    const message =
      existing.name !== project.name
        ? `Renamed project to "${project.name}"`
        : "Updated project settings";
    const activityWritten = writeProjectActivity(id, message, project.name);
    notify();
    return {
      ok: true,
      value: summary,
      issues: activityWritten
        ? []
        : ["The project was saved but its activity could not be updated."],
    };
  }

  function readProjectWorkspace(id: string): Workspace {
    const repository = createProjectRepository({
      projectId: id,
      storage,
      debounceMs: 0,
      now,
      newId,
      windowObject: null,
    });
    const { workspace } = repository.load();
    repository.dispose();
    return workspace;
  }

  function duplicateProject(id: string): CatalogResult<ProjectSummary> {
    const current = storedIndex();
    const source = current.projects[id];
    if (!source) {
      return { ok: false, issues: ["The project no longer exists."] };
    }
    if (current.projectIds.length >= MAX_PROJECTS) {
      return {
        ok: false,
        issues: [`The project limit is ${MAX_PROJECTS}.`],
      };
    }

    const newProjectId = newId();
    const workspace = readProjectWorkspace(id);
    const name = uniqueProjectName(
      `${source.name} copy`,
      Object.values(current.projects).map((project) => project.name),
    );
    const project = normalizeProject(
      {
        ...source,
        id: newProjectId,
        name,
        createdAt: now(),
        updatedAt: now(),
      },
      { id: newProjectId, newId, now },
    );
    const entry = createActivityEntry({
      id: newId(),
      message: `Duplicated from ${source.name}`,
      chapterId: null,
      chapterName: name,
      time: now(),
    });
    const copy = createWorkspace({
      projectId: newProjectId,
      chapters: workspace.chapters,
      events: [entry],
      selectedId: workspace.selectedId,
    });

    if (!writeProjectPayload(newProjectId, copy)) {
      return { ok: false, issues: ["The duplicate could not be saved."] };
    }

    const summary = summarizeProject(project, copy.chapters);
    const next: ProjectIndex = {
      ...current,
      activeProjectId: newProjectId,
      projectIds: [...current.projectIds, newProjectId],
      projects: { ...current.projects, [newProjectId]: summary },
    };
    if (!writeIndex(next)) {
      removeProjectPayload(newProjectId);
      return { ok: false, issues: ["The project list could not be saved."] };
    }
    notify();
    return { ok: true, value: summary, issues: [] };
  }

  function deleteProject(id: string): CatalogResult<DeleteProjectResult> {
    const current = storedIndex();
    if (!current.projects[id]) {
      return { ok: false, issues: ["The project no longer exists."] };
    }
    const projectIds = current.projectIds.filter(
      (projectId) => projectId !== id,
    );
    const activeProjectId =
      current.activeProjectId === id
        ? (projectIds[0] ?? null)
        : current.activeProjectId;
    const projects = { ...current.projects };
    delete projects[id];
    const next: ProjectIndex = {
      ...current,
      activeProjectId,
      projectIds,
      projects,
    };
    if (!writeIndex(next)) {
      return { ok: false, issues: ["The project list could not be saved."] };
    }
    removeProjectPayload(id);
    notify();
    return {
      ok: true,
      value: { activeProjectId },
      issues: [],
    };
  }

  function importProject(text: string): CatalogResult<ProjectSummary> {
    const current = storedIndex();
    if (current.projectIds.length >= MAX_PROJECTS) {
      return {
        ok: false,
        issues: [`The project limit is ${MAX_PROJECTS}.`],
      };
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      return { ok: false, issues: ["The selected file is not valid JSON."] };
    }

    const imported = normalizeProjectExport(parsed, { newId, now });
    if (!imported.workspace.chapters.rootIds.length) {
      return {
        ok: false,
        issues: imported.issues.length
          ? imported.issues
          : ["The file has no chapters."],
      };
    }

    const id = newId();
    const name = uniqueProjectName(
      imported.project.name,
      Object.values(current.projects).map((project) => project.name),
      { suffix: " (imported)" },
    );
    const project = normalizeProject(
      { ...imported.project, id, name },
      { id, newId, now },
    );
    const entry = createActivityEntry({
      id: newId(),
      message: `Imported project "${project.name}"`,
      chapterId: null,
      chapterName: project.name,
      time: now(),
    });
    const workspace = createWorkspace({
      projectId: id,
      chapters: imported.workspace.chapters,
      events: appendActivity(imported.workspace.events, entry),
      selectedId: imported.workspace.selectedId,
    });

    if (!writeProjectPayload(id, workspace)) {
      return {
        ok: false,
        issues: ["The imported project could not be saved."],
      };
    }

    const summary = summarizeProject(project, workspace.chapters);
    const next: ProjectIndex = {
      ...current,
      activeProjectId: id,
      projectIds: [...current.projectIds, id],
      projects: { ...current.projects, [id]: summary },
    };
    if (!writeIndex(next)) {
      removeProjectPayload(id);
      return { ok: false, issues: ["The project list could not be saved."] };
    }
    notify();
    return { ok: true, value: summary, issues: imported.issues };
  }

  function exportProject(id: string, workspace?: Workspace): string | null {
    const project = index.projects[id];
    if (!project) return null;
    const source = workspace ?? readProjectWorkspace(id);
    return JSON.stringify(
      serializeProjectExport(project, source, now()),
      null,
      2,
    );
  }

  function indexForMerge(): ProjectIndex {
    const result = readJson(storage, STORAGE_KEYS.index);
    if (
      result.status === "ok" &&
      isRecord(result.value) &&
      isRecord(result.value.projects) &&
      Array.isArray(result.value.projectIds)
    ) {
      return result.value as ProjectIndex;
    }
    return storedIndex();
  }

  function updateSummaryFromWorkspace(id: string, workspace: Workspace) {
    const current = indexForMerge();
    const existing = current.projects[id];
    if (!existing) return;
    const stats = summarizeDocument(workspace.chapters);
    const summary: ProjectSummary = {
      ...existing,
      ...stats,
      updatedAt: now(),
    };
    const next: ProjectIndex = {
      ...current,
      projects: { ...current.projects, [id]: summary },
    };
    if (writeIndex(next)) notify();
  }

  function createProjectRepositoryFor(id: string): ProjectRepository {
    return createProjectRepository({
      projectId: id,
      storage,
      debounceMs,
      now,
      newId,
      windowObject,
      onFlush: (workspace: Workspace, changed: ChangedSlices) => {
        if (changed.document) updateSummaryFromWorkspace(id, workspace);
      },
    });
  }

  function handleStorageEvent(event: { key?: string | null }) {
    const key = event?.key;
    if (key && key !== STORAGE_KEYS.index) return;
    const result = readJson(storage, STORAGE_KEYS.index);
    if (result.status === "ok") {
      index = normalizeProjectIndex(result.value, { newId, now }).index;
      notify();
      return;
    }
    if (result.status === "missing") {
      const loaded = load();
      index = loaded.index;
      notify();
    }
  }

  const onStorage = (event: StorageEvent) => handleStorageEvent(event);
  if (windowObject?.addEventListener) {
    windowObject.addEventListener("storage", onStorage as EventListener);
  }

  function retry() {
    if (writeIndex(index)) {
      setStatus(STORAGE_STATUS.saved, "Project list saved in this browser.");
    }
  }

  function dispose() {
    if (windowObject?.removeEventListener) {
      windowObject.removeEventListener("storage", onStorage as EventListener);
    }
    statusListeners.clear();
    indexListeners.clear();
  }

  return {
    load,
    listProjects,
    getProject,
    getActiveProjectId: () => index.activeProjectId,
    setActiveProject,
    createProject,
    updateProject,
    duplicateProject,
    deleteProject,
    importProject,
    exportProject,
    createProjectRepository: createProjectRepositoryFor,
    subscribe: (listener) => {
      indexListeners.add(listener);
      return () => indexListeners.delete(listener);
    },
    handleStorageEvent,
    status: () => currentStatus,
    onStatusChange: (listener) => {
      statusListeners.add(listener);
      return () => statusListeners.delete(listener);
    },
    retry,
    dispose,
  };
}

export function projectExportFilename(
  project: Project,
  date: Date = new Date(),
): string {
  const slug =
    project.name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 48) || "project";
  const stamp = date.toISOString().slice(0, 10);
  return `layers-${slug}-${stamp}.json`;
}
