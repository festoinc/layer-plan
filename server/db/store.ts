import type { DatabaseConnection } from "./client";
import {
  createActivityEntry,
  MAX_ACTIVITY_ENTRIES,
  type ActivityEntry,
  type CreateActivityInput,
} from "../../src/domain/activity";
import {
  createChapter,
  getDefaultId,
  type ChapterDocument,
} from "../../src/domain/chapters";
import {
  isSafeProjectId,
  MAX_PROJECTS,
  normalizeProject,
  sortProjects,
  summarizeDocument,
  uniqueProjectName,
  type Project,
  type ProjectColor,
  type ProjectInput,
  type ProjectPatch,
  type ProjectStats,
  type ProjectSummary,
} from "../../src/domain/projects";
import {
  createId,
  createWorkspace,
  normalizeDocument,
  normalizeProjectExport,
  normalizeTestGuidelines,
  SCHEMA_VERSION,
  serializeProjectExport,
  type ProjectExport,
} from "../../src/domain/schema";
import {
  getCoverageRows,
  summarizeVerification,
  type CoverageRow,
  type VerificationSummary,
} from "../../src/domain/verification";
import { sampleProjects } from "../../src/data";
import { ApiError } from "../api/errors";

export interface ProjectDetail extends ProjectSummary {
  testGuidelines: string;
  metadataRevision: number;
  documentRevision: number;
}

export interface DocumentSnapshot {
  schemaVersion: number;
  projectId: string;
  revision: number;
  updatedAt: string;
  chapters: ChapterDocument;
  selectedId: string | null;
}

export interface SaveDocumentInput {
  chapters: ChapterDocument;
  selectedId: string | null;
  activity?: CreateActivityInput[];
}

export interface SaveDocumentResult {
  document: DocumentSnapshot;
  activity: ActivityEntry[];
  stats: ProjectStats;
}

export interface ImportProjectResult {
  project: ProjectDetail;
  issues: string[];
}

export interface ProjectListResult {
  projects: ProjectSummary[];
  activeProjectId: string | null;
}

export interface CoverageResult {
  summary: VerificationSummary;
  rows: CoverageRow[];
  testGuidelines: string;
}

interface ProjectRow {
  id: string;
  name: string;
  initials: string;
  color: string;
  description: string;
  test_guidelines: string;
  chapter_count: number;
  criterion_count: number;
  checked_count: number;
  metadata_revision: number;
  created_at: string;
  updated_at: string;
  document_revision: number | null;
}

interface DocumentRow {
  project_id: string;
  revision: number;
  chapters_json: string;
  selected_id: string | null;
  updated_at: string;
}

interface ActivityRow {
  sequence: number;
  id: string;
  project_id: string;
  message: string;
  chapter_id: string | null;
  chapter_name: string;
  created_at: string;
}

export interface ProjectStoreOptions {
  now?: () => string;
  newId?: () => string;
}

export interface ProjectStore {
  listProjects(): ProjectListResult;
  getProject(id: string): ProjectDetail | null;
  createProject(input: ProjectInput & { id?: string }): ProjectDetail;
  updateProject(
    id: string,
    patch: ProjectPatch,
    expectedRevision: number,
  ): ProjectDetail;
  deleteProject(
    id: string,
    expectedRevision: number,
  ): { activeProjectId: string | null };
  duplicateProject(id: string): ProjectDetail;
  activateProject(id: string): string | null;
  getDocument(id: string): DocumentSnapshot | null;
  saveDocument(
    id: string,
    input: SaveDocumentInput,
    expectedRevision: number,
  ): SaveDocumentResult;
  listActivity(
    id: string,
    options?: { limit?: number; before?: number },
  ): ActivityEntry[];
  appendActivity(id: string, input: CreateActivityInput): ActivityEntry[];
  getCoverage(id: string): CoverageResult | null;
  exportProject(id: string): ProjectExport | null;
  importProject(raw: unknown): ImportProjectResult;
  reset(seed?: boolean): void;
  close(): void;
}

function projectFromRow(row: ProjectRow): Project {
  return {
    id: row.id,
    name: row.name,
    initials: row.initials,
    color: row.color as ProjectColor,
    description: row.description,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function summaryFromRow(row: ProjectRow): ProjectSummary {
  return {
    ...projectFromRow(row),
    chapterCount: row.chapter_count,
    criterionCount: row.criterion_count,
    checkedCount: row.checked_count,
  };
}

function detailFromRow(row: ProjectRow): ProjectDetail {
  return {
    ...summaryFromRow(row),
    testGuidelines: row.test_guidelines,
    metadataRevision: row.metadata_revision,
    documentRevision: row.document_revision ?? 1,
  };
}

function activityFromRow(row: ActivityRow): ActivityEntry {
  return {
    id: row.id,
    message: row.message,
    chapterId: row.chapter_id,
    chapterName: row.chapter_name,
    time: row.created_at,
  };
}

function assertProjectId(id: string): void {
  if (!isSafeProjectId(id)) {
    throw new ApiError(422, "validation_failed", "The project id is invalid.");
  }
}

function assertActivityInput(input: CreateActivityInput): void {
  if (!input.id || input.id.length > 128) {
    throw new ApiError(
      422,
      "validation_failed",
      "An activity entry has an invalid id.",
    );
  }
  if (!input.message || input.message.length > 1000) {
    throw new ApiError(
      422,
      "validation_failed",
      "An activity message must be between 1 and 1000 characters.",
    );
  }
}

export class SqliteStore implements ProjectStore {
  private readonly db: DatabaseConnection;
  private readonly now: () => string;
  private readonly newId: () => string;

  constructor(db: DatabaseConnection, options: ProjectStoreOptions = {}) {
    this.db = db;
    this.now = options.now ?? (() => new Date().toISOString());
    this.newId = options.newId ?? createId;
  }

  private projectRow(id: string): ProjectRow | null {
    const row = this.db
      .prepare(
        `SELECT p.*, d.revision AS document_revision
         FROM projects p
         LEFT JOIN project_documents d ON d.project_id = p.id
         WHERE p.id = ?`,
      )
      .get(id) as ProjectRow | undefined;
    return row ?? null;
  }

  private documentRow(id: string): DocumentRow | null {
    const row = this.db
      .prepare("SELECT * FROM project_documents WHERE project_id = ?")
      .get(id) as DocumentRow | undefined;
    return row ?? null;
  }

  private requireProject(id: string): ProjectRow {
    const row = this.projectRow(id);
    if (!row) {
      throw new ApiError(404, "not_found", "The project does not exist.");
    }
    return row;
  }

  private requireDocument(id: string): DocumentRow {
    const row = this.documentRow(id);
    if (!row) {
      throw new ApiError(
        500,
        "stored_data_invalid",
        "The project document is missing.",
      );
    }
    return row;
  }

  private activeProjectId(): string | null {
    const state = this.db
      .prepare("SELECT value FROM app_state WHERE key = 'active_project_id'")
      .get() as { value: string | null } | undefined;
    const candidate = state?.value ?? null;
    if (candidate && this.projectRow(candidate)) return candidate;

    const first = sortProjects(this.allSummaries(), null)[0]?.id ?? null;
    this.setActiveProjectId(first);
    return first;
  }

  private setActiveProjectId(id: string | null): void {
    this.db
      .prepare(
        `INSERT INTO app_state (key, value) VALUES ('active_project_id', ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      )
      .run(id);
  }

  private allSummaries(): ProjectSummary[] {
    const rows = this.db
      .prepare("SELECT * FROM projects")
      .all() as ProjectRow[];
    return rows.map(summaryFromRow);
  }

  private projectNames(): string[] {
    return (
      this.db.prepare("SELECT name FROM projects").all() as Array<{
        name: string;
      }>
    ).map((row) => row.name);
  }

  private insertProjectRow(
    project: Project,
    stats: ProjectStats,
    testGuidelines: string,
    timestamp: string,
  ): void {
    this.db
      .prepare(
        `INSERT INTO projects (
          id, name, initials, color, description, test_guidelines,
          chapter_count, criterion_count, checked_count,
          metadata_revision, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
      )
      .run(
        project.id,
        project.name,
        project.initials,
        project.color,
        project.description,
        normalizeTestGuidelines(testGuidelines),
        stats.chapterCount,
        stats.criterionCount,
        stats.checkedCount,
        timestamp,
        timestamp,
      );
  }

  private insertDocumentRow(
    projectId: string,
    document: ChapterDocument,
    selectedId: string | null,
    timestamp: string,
    revision = 1,
  ): void {
    this.db
      .prepare(
        `INSERT INTO project_documents
          (project_id, revision, chapters_json, selected_id, updated_at)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(
        projectId,
        revision,
        JSON.stringify(document),
        selectedId,
        timestamp,
      );
  }

  private insertActivityRow(projectId: string, entry: ActivityEntry): void {
    assertActivityInput(entry);
    this.db
      .prepare(
        `INSERT OR IGNORE INTO activity_entries
          (id, project_id, message, chapter_id, chapter_name, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        entry.id,
        projectId,
        entry.message,
        entry.chapterId,
        entry.chapterName,
        entry.time,
      );
  }

  private activityMessage(
    projectId: string,
    message: string,
    chapterName: string,
    chapterId: string | null = null,
  ): void {
    this.insertActivityRow(
      projectId,
      createActivityEntry({
        id: this.newId(),
        message,
        chapterId,
        chapterName,
        time: this.now(),
      }),
    );
  }

  private trimActivity(projectId: string): void {
    this.db
      .prepare(
        `DELETE FROM activity_entries
         WHERE project_id = ?
           AND sequence NOT IN (
             SELECT sequence FROM activity_entries
             WHERE project_id = ?
             ORDER BY sequence DESC
             LIMIT ?
           )`,
      )
      .run(projectId, projectId, MAX_ACTIVITY_ENTRIES);
  }

  private insertNewActivity(
    projectId: string,
    inputs: CreateActivityInput[],
  ): void {
    for (const input of inputs) {
      assertActivityInput(input);
      this.insertActivityRow(
        projectId,
        createActivityEntry({
          id: input.id,
          message: input.message,
          chapterId: input.chapterId,
          chapterName: input.chapterName,
          time: this.now(),
        }),
      );
    }
    this.trimActivity(projectId);
  }

  listProjects(): ProjectListResult {
    const activeProjectId = this.activeProjectId();
    return {
      projects: sortProjects(this.allSummaries(), activeProjectId),
      activeProjectId,
    };
  }

  getProject(id: string): ProjectDetail | null {
    const row = this.projectRow(id);
    return row ? detailFromRow(row) : null;
  }

  createProject(input: ProjectInput & { id?: string }): ProjectDetail {
    const id = input.id ?? this.newId();
    assertProjectId(id);
    if (this.projectRow(id)) {
      throw new ApiError(409, "project_exists", "That project id is in use.");
    }
    const count = (
      this.db.prepare("SELECT COUNT(*) AS count FROM projects").get() as {
        count: number;
      }
    ).count;
    if (count >= MAX_PROJECTS) {
      throw new ApiError(
        409,
        "project_limit",
        `The project limit is ${MAX_PROJECTS}.`,
      );
    }

    const timestamp = this.now();
    const project = normalizeProject(
      {
        ...input,
        id,
        createdAt: timestamp,
        updatedAt: timestamp,
      },
      { id, newId: this.newId, now: this.now },
    );
    const chapter = createChapter({ id: this.newId(), title: "Overview" });
    const chapters: ChapterDocument = {
      byId: { [chapter.id]: chapter },
      rootIds: [chapter.id],
    };
    const stats = summarizeDocument(chapters);

    const transaction = this.db.transaction(() => {
      this.insertProjectRow(
        project,
        stats,
        input.testGuidelines ?? "",
        timestamp,
      );
      this.insertDocumentRow(project.id, chapters, chapter.id, timestamp);
      this.activityMessage(
        project.id,
        "Created project",
        chapter.title,
        chapter.id,
      );
      this.setActiveProjectId(project.id);
    });
    transaction();

    return this.requireDetail(project.id);
  }

  updateProject(
    id: string,
    patch: ProjectPatch,
    expectedRevision: number,
  ): ProjectDetail {
    const row = this.requireProject(id);
    if (row.metadata_revision !== expectedRevision) {
      throw new ApiError(
        412,
        "revision_conflict",
        "The project changed since it was loaded.",
        { currentRevision: row.metadata_revision },
      );
    }

    const existing = projectFromRow(row);
    const nextGuidelines =
      patch.testGuidelines === undefined
        ? row.test_guidelines
        : normalizeTestGuidelines(patch.testGuidelines);
    const project = normalizeProject(
      { ...existing, ...patch, id, updatedAt: this.now() },
      { id, newId: this.newId, now: this.now },
    );

    const guidelinesChanged = nextGuidelines !== row.test_guidelines;
    const metadataChanged =
      project.name !== row.name ||
      project.initials !== row.initials ||
      project.color !== row.color ||
      project.description !== row.description;
    if (!guidelinesChanged && !metadataChanged) {
      return detailFromRow(row);
    }

    const message =
      row.name !== project.name
        ? `Renamed project to "${project.name}"`
        : guidelinesChanged
          ? "Updated test guidelines"
          : "Updated project settings";

    const transaction = this.db.transaction(() => {
      this.db
        .prepare(
          `UPDATE projects SET
            name = ?, initials = ?, color = ?, description = ?,
            test_guidelines = ?, metadata_revision = metadata_revision + 1,
            updated_at = ?
           WHERE id = ?`,
        )
        .run(
          project.name,
          project.initials,
          project.color,
          project.description,
          nextGuidelines,
          project.updatedAt,
          id,
        );
      this.activityMessage(id, message, project.name);
    });
    transaction();

    return this.requireDetail(id);
  }

  deleteProject(
    id: string,
    expectedRevision: number,
  ): { activeProjectId: string | null } {
    const row = this.requireProject(id);
    if (row.metadata_revision !== expectedRevision) {
      throw new ApiError(
        412,
        "revision_conflict",
        "The project changed since it was loaded.",
        { currentRevision: row.metadata_revision },
      );
    }
    const wasActive = this.activeProjectId() === id;

    const transaction = this.db.transaction(() => {
      this.db.prepare("DELETE FROM projects WHERE id = ?").run(id);
      if (wasActive) {
        const next = sortProjects(this.allSummaries(), null)[0]?.id ?? null;
        this.setActiveProjectId(next);
      }
    });
    transaction();

    return { activeProjectId: this.activeProjectId() };
  }

  duplicateProject(id: string): ProjectDetail {
    const source = this.requireProject(id);
    const sourceDocument = this.getDocument(id);
    if (!sourceDocument) {
      throw new ApiError(
        500,
        "stored_data_invalid",
        "The project document is missing.",
      );
    }
    const count = (
      this.db.prepare("SELECT COUNT(*) AS count FROM projects").get() as {
        count: number;
      }
    ).count;
    if (count >= MAX_PROJECTS) {
      throw new ApiError(
        409,
        "project_limit",
        `The project limit is ${MAX_PROJECTS}.`,
      );
    }

    const newProjectId = this.newId();
    const name = uniqueProjectName(`${source.name} copy`, this.projectNames());
    const timestamp = this.now();
    const project = normalizeProject(
      {
        ...projectFromRow(source),
        id: newProjectId,
        name,
        createdAt: timestamp,
        updatedAt: timestamp,
      },
      { id: newProjectId, newId: this.newId, now: this.now },
    );
    const chapters = sourceDocument.chapters;
    const selectedId = sourceDocument.selectedId;
    const stats = summarizeDocument(chapters);

    const transaction = this.db.transaction(() => {
      this.insertProjectRow(project, stats, source.test_guidelines, timestamp);
      this.insertDocumentRow(project.id, chapters, selectedId, timestamp);
      this.activityMessage(
        project.id,
        `Duplicated from ${source.name}`,
        project.name,
      );
      this.setActiveProjectId(project.id);
    });
    transaction();

    return this.requireDetail(project.id);
  }

  activateProject(id: string): string | null {
    this.requireProject(id);
    this.setActiveProjectId(id);
    return id;
  }

  getDocument(id: string): DocumentSnapshot | null {
    this.requireProject(id);
    const row = this.requireDocument(id);
    let parsed: unknown;
    try {
      parsed = JSON.parse(row.chapters_json) as unknown;
    } catch {
      throw new ApiError(
        500,
        "stored_data_invalid",
        "The stored project document is not valid JSON.",
      );
    }
    const normalized = normalizeDocument(parsed, { newId: this.newId });
    if (normalized.issues.length) {
      throw new ApiError(
        500,
        "stored_data_invalid",
        "The stored project document could not be read.",
        { issues: normalized.issues.slice(0, 10) },
      );
    }
    return {
      schemaVersion: SCHEMA_VERSION,
      projectId: id,
      revision: row.revision,
      updatedAt: row.updated_at,
      chapters: normalized.document,
      selectedId: getDefaultId(normalized.document, row.selected_id),
    };
  }

  saveDocument(
    id: string,
    input: SaveDocumentInput,
    expectedRevision: number,
  ): SaveDocumentResult {
    this.requireProject(id);
    const row = this.requireDocument(id);
    if (row.revision !== expectedRevision) {
      throw new ApiError(
        412,
        "revision_conflict",
        "The document changed since it was loaded.",
        { currentRevision: row.revision },
      );
    }

    const normalized = normalizeDocument(input.chapters, {
      newId: this.newId,
    });
    if (normalized.issues.length) {
      throw new ApiError(
        422,
        "validation_failed",
        "The document could not be normalized.",
        { issues: normalized.issues.slice(0, 20) },
      );
    }
    const chapters = normalized.document;
    const chapterCount = Object.keys(chapters.byId).length;
    if (chapterCount > 5000) {
      throw new ApiError(
        422,
        "validation_failed",
        "The document has more than 5000 chapters.",
      );
    }
    for (const chapter of Object.values(chapters.byId)) {
      if (chapter.criteria.length > 500) {
        throw new ApiError(
          422,
          "validation_failed",
          "A chapter has more than 500 criteria.",
        );
      }
    }
    if (input.selectedId !== null && !chapters.byId[input.selectedId]) {
      throw new ApiError(
        422,
        "validation_failed",
        "selectedId must be null or refer to a chapter in the document.",
      );
    }

    const selectedId = input.selectedId;
    const stats = summarizeDocument(chapters);
    const chaptersJson = JSON.stringify(chapters);
    const changed =
      chaptersJson !== row.chapters_json || selectedId !== row.selected_id;
    const revision = changed ? row.revision + 1 : row.revision;
    const timestamp = changed ? this.now() : row.updated_at;

    const transaction = this.db.transaction(() => {
      if (changed) {
        this.db
          .prepare(
            `UPDATE project_documents SET
              revision = ?, chapters_json = ?, selected_id = ?, updated_at = ?
             WHERE project_id = ?`,
          )
          .run(revision, chaptersJson, selectedId, timestamp, id);
        this.db
          .prepare(
            `UPDATE projects SET
              chapter_count = ?, criterion_count = ?, checked_count = ?,
              updated_at = ?
             WHERE id = ?`,
          )
          .run(
            stats.chapterCount,
            stats.criterionCount,
            stats.checkedCount,
            timestamp,
            id,
          );
      }
      this.insertNewActivity(id, input.activity ?? []);
    });
    transaction();

    return {
      document: {
        schemaVersion: SCHEMA_VERSION,
        projectId: id,
        revision,
        updatedAt: timestamp,
        chapters,
        selectedId,
      },
      activity: this.listActivity(id),
      stats,
    };
  }

  listActivity(
    id: string,
    options: { limit?: number; before?: number } = {},
  ): ActivityEntry[] {
    this.requireProject(id);
    const limit = Math.min(Math.max(options.limit ?? 100, 1), 100);
    const rows = options.before
      ? (this.db
          .prepare(
            `SELECT * FROM activity_entries
             WHERE project_id = ? AND sequence < ?
             ORDER BY sequence DESC LIMIT ?`,
          )
          .all(id, options.before, limit) as ActivityRow[])
      : (this.db
          .prepare(
            `SELECT * FROM activity_entries
             WHERE project_id = ?
             ORDER BY sequence DESC LIMIT ?`,
          )
          .all(id, limit) as ActivityRow[]);
    return rows.map(activityFromRow);
  }

  appendActivity(id: string, input: CreateActivityInput): ActivityEntry[] {
    this.requireProject(id);
    const transaction = this.db.transaction(() => {
      this.insertNewActivity(id, [input]);
    });
    transaction();
    return this.listActivity(id);
  }

  getCoverage(id: string): CoverageResult | null {
    const row = this.requireProject(id);
    const document = this.getDocument(id);
    if (!document) return null;
    return {
      summary: summarizeVerification(document.chapters),
      rows: getCoverageRows(document.chapters),
      testGuidelines: row.test_guidelines,
    };
  }

  exportProject(id: string): ProjectExport | null {
    const row = this.requireProject(id);
    const document = this.getDocument(id);
    if (!document) return null;
    const workspace = createWorkspace({
      projectId: id,
      chapters: document.chapters,
      events: this.listActivity(id),
      selectedId: document.selectedId,
    });
    return serializeProjectExport(
      projectFromRow(row),
      workspace,
      row.test_guidelines,
      this.now(),
    );
  }

  importProject(raw: unknown): ImportProjectResult {
    const count = (
      this.db.prepare("SELECT COUNT(*) AS count FROM projects").get() as {
        count: number;
      }
    ).count;
    if (count >= MAX_PROJECTS) {
      throw new ApiError(
        409,
        "project_limit",
        `The project limit is ${MAX_PROJECTS}.`,
      );
    }

    const imported = normalizeProjectExport(raw, {
      newId: this.newId,
      now: this.now,
    });
    if (!imported.workspace.chapters.rootIds.length) {
      throw new ApiError(
        422,
        "validation_failed",
        imported.issues.length
          ? imported.issues.join(" ")
          : "The file has no chapters.",
      );
    }

    const id = this.newId();
    const name = uniqueProjectName(imported.project.name, this.projectNames(), {
      suffix: " (imported)",
    });
    const timestamp = this.now();
    const project = normalizeProject(
      {
        ...imported.project,
        id,
        name,
        createdAt: timestamp,
        updatedAt: timestamp,
      },
      { id, newId: this.newId, now: this.now },
    );
    const document = imported.workspace.chapters;
    const selectedId = getDefaultId(document, imported.workspace.selectedId);
    const stats = summarizeDocument(document);

    const transaction = this.db.transaction(() => {
      this.insertProjectRow(project, stats, imported.testGuidelines, timestamp);
      this.insertDocumentRow(project.id, document, selectedId, timestamp);
      for (const event of imported.workspace.events) {
        this.insertActivityRow(project.id, event);
      }
      this.activityMessage(
        project.id,
        `Imported project "${project.name}"`,
        project.name,
      );
      this.trimActivity(project.id);
      this.setActiveProjectId(project.id);
    });
    transaction();

    return {
      project: this.requireDetail(project.id),
      issues: imported.issues,
    };
  }

  reset(seed = false): void {
    const transaction = this.db.transaction(() => {
      this.db.exec(`
        DELETE FROM activity_entries;
        DELETE FROM project_documents;
        DELETE FROM projects;
        DELETE FROM app_state;
        DELETE FROM sqlite_sequence WHERE name = 'activity_entries';
      `);
    });
    transaction();
    if (seed) this.seedSamples();
  }

  seedSamples(): boolean {
    const count = (
      this.db.prepare("SELECT COUNT(*) AS count FROM projects").get() as {
        count: number;
      }
    ).count;
    if (count > 0) return false;

    const transaction = this.db.transaction(() => {
      let firstId: string | null = null;
      for (const sample of sampleProjects) {
        const timestamp = this.now();
        const project = normalizeProject(
          {
            ...sample.project,
            createdAt: timestamp,
            updatedAt: timestamp,
          },
          { id: sample.project.id, newId: this.newId, now: this.now },
        );
        const normalized = normalizeDocument(sample.chapters, {
          newId: this.newId,
        });
        if (normalized.issues.length) {
          throw new Error(
            `Sample project ${sample.project.id} is invalid: ${normalized.issues.join(" ")}`,
          );
        }
        const selectedId = getDefaultId(normalized.document, sample.selectedId);
        const stats = summarizeDocument(normalized.document);
        this.insertProjectRow(project, stats, sample.testGuidelines, timestamp);
        this.insertDocumentRow(
          project.id,
          normalized.document,
          selectedId,
          timestamp,
        );
        if (!firstId) firstId = project.id;
      }
      this.setActiveProjectId(firstId);
    });
    transaction();
    return true;
  }

  close(): void {
    this.db.close();
  }

  private requireDetail(id: string): ProjectDetail {
    const row = this.requireProject(id);
    return detailFromRow(row);
  }
}
