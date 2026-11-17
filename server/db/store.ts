import { createHash } from "node:crypto";
import type { DatabaseConnection } from "./client";
import {
  MAX_ATTACHMENTS,
  MAX_ATTACHMENT_BYTES,
  type AttachmentInfo,
} from "../../src/domain/attachments";
import {
  createActivityEntry,
  MAX_ACTIVITY_ENTRIES,
  type ActivityEntry,
  type CreateActivityInput,
} from "../../src/domain/activity";
import {
  createChapter,
  getDefaultId,
  insertChapter,
  patchChapter,
  walkChapters,
  type ChapterDocument,
} from "../../src/domain/chapters";
import { createSubchapterFromCriterion } from "../../src/domain/criteria";
import {
  reconcileCriterionLinks,
  type CriterionSync,
} from "../../src/domain/criterionLinks";
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

export interface CreatedCriterionSubchapter {
  id: string;
  parentId: string;
  criterionId: string;
  title: string;
}

export interface SaveDocumentResult {
  document: DocumentSnapshot;
  activity: ActivityEntry[];
  stats: ProjectStats;
  createdSubchapters: CreatedCriterionSubchapter[];
  sync: CriterionSync;
}

export interface ImportProjectResult {
  project: ProjectDetail;
  issues: string[];
}

export interface AddAttachmentInput {
  filename: string;
  contentType: string;
  content: Buffer;
}

export interface AttachmentRecord extends AttachmentInfo {
  content: Buffer;
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
  owner_id: string | null;
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
  actor_user_id: string | null;
  actor_name: string | null;
}

interface AttachmentRow {
  id: string;
  project_id: string;
  filename: string;
  content_type: string;
  size_bytes: number;
  sha256: string;
  created_at: string;
  created_by: string | null;
  created_by_name: string | null;
}

interface AttachmentContentRow extends AttachmentRow {
  content: Buffer;
}

export interface ProjectStoreOptions {
  now?: () => string;
  newId?: () => string;
}

export interface ProjectStore {
  listProjects(ownerId: string): ProjectListResult;
  getProject(ownerId: string, id: string): ProjectDetail | null;
  createProject(
    ownerId: string,
    input: ProjectInput & { id?: string },
  ): ProjectDetail;
  updateProject(
    ownerId: string,
    id: string,
    patch: ProjectPatch,
    expectedRevision: number,
  ): ProjectDetail;
  deleteProject(
    ownerId: string,
    id: string,
    expectedRevision: number,
  ): { activeProjectId: string | null };
  duplicateProject(ownerId: string, id: string): ProjectDetail;
  activateProject(ownerId: string, id: string): string | null;
  getDocument(ownerId: string, id: string): DocumentSnapshot | null;
  saveDocument(
    ownerId: string,
    id: string,
    input: SaveDocumentInput,
    expectedRevision: number,
  ): SaveDocumentResult;
  listActivity(
    ownerId: string,
    id: string,
    options?: { limit?: number; before?: number },
  ): ActivityEntry[];
  appendActivity(
    ownerId: string,
    id: string,
    input: CreateActivityInput,
  ): ActivityEntry[];
  listAttachments(ownerId: string, id: string): AttachmentInfo[];
  getAttachment(
    ownerId: string,
    id: string,
    attachmentId: string,
  ): AttachmentRecord | null;
  addAttachment(
    ownerId: string,
    id: string,
    input: AddAttachmentInput,
  ): AttachmentInfo;
  deleteAttachment(ownerId: string, id: string, attachmentId: string): void;
  getCoverage(ownerId: string, id: string): CoverageResult | null;
  exportProject(ownerId: string, id: string): ProjectExport | null;
  importProject(ownerId: string, raw: unknown): ImportProjectResult;
  getUserState(ownerId: string): { activeProjectId: string | null };
  claimUnownedProjects(ownerId: string): number;
  migrateLegacyActiveProject(ownerId: string): void;
  reset(): void;
  seedSamples(ownerId: string): boolean;
  ping(): void;
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
    ...(row.actor_user_id ? { actorUserId: row.actor_user_id } : {}),
    ...(row.actor_name ? { actorName: row.actor_name } : {}),
  };
}

function attachmentFromRow(row: AttachmentRow): AttachmentInfo {
  return {
    id: row.id,
    projectId: row.project_id,
    filename: row.filename,
    contentType: row.content_type,
    sizeBytes: row.size_bytes,
    sha256: row.sha256,
    createdAt: row.created_at,
    createdByName: row.created_by_name,
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

  private projectRow(ownerId: string, id: string): ProjectRow | null {
    const row = this.db
      .prepare(
        `SELECT p.*, d.revision AS document_revision
         FROM projects p
         LEFT JOIN project_documents d ON d.project_id = p.id
         WHERE p.id = ? AND p.owner_id = ?`,
      )
      .get(id, ownerId) as ProjectRow | undefined;
    return row ?? null;
  }

  private documentRow(ownerId: string, id: string): DocumentRow | null {
    const row = this.db
      .prepare(
        `SELECT d.* FROM project_documents d
         JOIN projects p ON p.id = d.project_id
         WHERE d.project_id = ? AND p.owner_id = ?`,
      )
      .get(id, ownerId) as DocumentRow | undefined;
    return row ?? null;
  }

  private requireProject(ownerId: string, id: string): ProjectRow {
    const row = this.projectRow(ownerId, id);
    if (!row) {
      throw new ApiError(404, "not_found", "The project does not exist.");
    }
    return row;
  }

  private requireDocument(ownerId: string, id: string): DocumentRow {
    const row = this.documentRow(ownerId, id);
    if (!row) {
      throw new ApiError(
        500,
        "stored_data_invalid",
        "The project document is missing.",
      );
    }
    return row;
  }

  private activeProjectId(ownerId: string): string | null {
    const state = this.db
      .prepare("SELECT active_project_id FROM user_state WHERE user_id = ?")
      .get(ownerId) as { active_project_id: string | null } | undefined;
    const candidate = state?.active_project_id ?? null;
    if (candidate && this.projectRow(ownerId, candidate)) return candidate;

    const first = sortProjects(this.allSummaries(ownerId), null)[0]?.id ?? null;
    this.setActiveProjectId(ownerId, first);
    return first;
  }

  private setActiveProjectId(ownerId: string, id: string | null): void {
    this.db
      .prepare(
        `INSERT INTO user_state (user_id, active_project_id)
         VALUES (?, ?)
         ON CONFLICT(user_id) DO UPDATE SET
           active_project_id = excluded.active_project_id`,
      )
      .run(ownerId, id);
  }

  private allSummaries(ownerId: string): ProjectSummary[] {
    const rows = this.db
      .prepare("SELECT * FROM projects WHERE owner_id = ?")
      .all(ownerId) as ProjectRow[];
    return rows.map(summaryFromRow);
  }

  private projectNames(ownerId: string): string[] {
    return (
      this.db
        .prepare("SELECT name FROM projects WHERE owner_id = ?")
        .all(ownerId) as Array<{
        name: string;
      }>
    ).map((row) => row.name);
  }

  private insertProjectRow(
    ownerId: string,
    project: Project,
    stats: ProjectStats,
    testGuidelines: string,
    timestamp: string,
  ): void {
    this.db
      .prepare(
        `INSERT INTO projects (
          id, owner_id, name, initials, color, description, test_guidelines,
          chapter_count, criterion_count, checked_count,
          metadata_revision, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
      )
      .run(
        project.id,
        ownerId,
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

  private insertActivityRow(
    projectId: string,
    entry: ActivityEntry,
    actorUserId: string | null = null,
  ): void {
    assertActivityInput(entry);
    this.db
      .prepare(
        `INSERT OR IGNORE INTO activity_entries
          (id, project_id, message, chapter_id, chapter_name, created_at,
           actor_user_id)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        entry.id,
        projectId,
        entry.message,
        entry.chapterId,
        entry.chapterName,
        entry.time,
        entry.actorUserId ?? actorUserId,
      );
  }

  private activityMessage(
    projectId: string,
    message: string,
    chapterName: string,
    chapterId: string | null = null,
    actorUserId: string | null = null,
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
      actorUserId,
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
    actorUserId: string,
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
        actorUserId,
      );
    }
    this.trimActivity(projectId);
  }

  listProjects(ownerId: string): ProjectListResult {
    const activeProjectId = this.activeProjectId(ownerId);
    return {
      projects: sortProjects(this.allSummaries(ownerId), activeProjectId),
      activeProjectId,
    };
  }

  getProject(ownerId: string, id: string): ProjectDetail | null {
    const row = this.projectRow(ownerId, id);
    return row ? detailFromRow(row) : null;
  }

  createProject(
    ownerId: string,
    input: ProjectInput & { id?: string },
  ): ProjectDetail {
    const id = input.id ?? this.newId();
    assertProjectId(id);
    if (this.db.prepare("SELECT 1 FROM projects WHERE id = ?").get(id)) {
      throw new ApiError(409, "project_exists", "That project id is in use.");
    }
    const count = (
      this.db
        .prepare("SELECT COUNT(*) AS count FROM projects WHERE owner_id = ?")
        .get(ownerId) as {
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
        ownerId,
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
        ownerId,
      );
      this.setActiveProjectId(ownerId, project.id);
    });
    transaction();

    return this.requireDetail(ownerId, project.id);
  }

  updateProject(
    ownerId: string,
    id: string,
    patch: ProjectPatch,
    expectedRevision: number,
  ): ProjectDetail {
    const row = this.requireProject(ownerId, id);
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
           WHERE id = ? AND owner_id = ?`,
        )
        .run(
          project.name,
          project.initials,
          project.color,
          project.description,
          nextGuidelines,
          project.updatedAt,
          id,
          ownerId,
        );
      this.activityMessage(id, message, project.name, null, ownerId);
    });
    transaction();

    return this.requireDetail(ownerId, id);
  }

  deleteProject(
    ownerId: string,
    id: string,
    expectedRevision: number,
  ): { activeProjectId: string | null } {
    const row = this.requireProject(ownerId, id);
    if (row.metadata_revision !== expectedRevision) {
      throw new ApiError(
        412,
        "revision_conflict",
        "The project changed since it was loaded.",
        { currentRevision: row.metadata_revision },
      );
    }
    const wasActive = this.activeProjectId(ownerId) === id;

    const transaction = this.db.transaction(() => {
      this.db
        .prepare("DELETE FROM projects WHERE id = ? AND owner_id = ?")
        .run(id, ownerId);
      if (wasActive) {
        const next =
          sortProjects(this.allSummaries(ownerId), null)[0]?.id ?? null;
        this.setActiveProjectId(ownerId, next);
      }
    });
    transaction();

    return { activeProjectId: this.activeProjectId(ownerId) };
  }

  duplicateProject(ownerId: string, id: string): ProjectDetail {
    const source = this.requireProject(ownerId, id);
    const sourceDocument = this.getDocument(ownerId, id);
    if (!sourceDocument) {
      throw new ApiError(
        500,
        "stored_data_invalid",
        "The project document is missing.",
      );
    }
    const count = (
      this.db
        .prepare("SELECT COUNT(*) AS count FROM projects WHERE owner_id = ?")
        .get(ownerId) as {
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
    const name = uniqueProjectName(
      `${source.name} copy`,
      this.projectNames(ownerId),
    );
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
      this.insertProjectRow(
        ownerId,
        project,
        stats,
        source.test_guidelines,
        timestamp,
      );
      this.insertDocumentRow(project.id, chapters, selectedId, timestamp);
      const sourceAttachments = this.db
        .prepare("SELECT * FROM attachments WHERE project_id = ?")
        .all(id) as AttachmentContentRow[];
      for (const attachment of sourceAttachments) {
        this.db
          .prepare(
            `INSERT INTO attachments (
              id, project_id, filename, content_type, size_bytes, sha256,
              content, created_at, created_by
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(
            this.newId(),
            project.id,
            attachment.filename,
            attachment.content_type,
            attachment.size_bytes,
            attachment.sha256,
            attachment.content,
            timestamp,
            attachment.created_by,
          );
      }
      this.activityMessage(
        project.id,
        `Duplicated from ${source.name}`,
        project.name,
        null,
        ownerId,
      );
      this.setActiveProjectId(ownerId, project.id);
    });
    transaction();

    return this.requireDetail(ownerId, project.id);
  }

  activateProject(ownerId: string, id: string): string | null {
    this.requireProject(ownerId, id);
    this.setActiveProjectId(ownerId, id);
    return id;
  }

  getDocument(ownerId: string, id: string): DocumentSnapshot | null {
    this.requireProject(ownerId, id);
    const row = this.requireDocument(ownerId, id);
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
    ownerId: string,
    id: string,
    input: SaveDocumentInput,
    expectedRevision: number,
  ): SaveDocumentResult {
    this.requireProject(ownerId, id);
    const row = this.requireDocument(ownerId, id);
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
    const normalizedChapters = normalized.document;
    const chapterCount = Object.keys(normalizedChapters.byId).length;
    if (chapterCount > 5000) {
      throw new ApiError(
        422,
        "validation_failed",
        "The document has more than 5000 chapters.",
      );
    }
    for (const chapter of Object.values(normalizedChapters.byId)) {
      if (chapter.criteria.length > 500) {
        throw new ApiError(
          422,
          "validation_failed",
          "A chapter has more than 500 criteria.",
        );
      }
    }
    if (
      input.selectedId !== null &&
      !normalizedChapters.byId[input.selectedId]
    ) {
      throw new ApiError(
        422,
        "validation_failed",
        "selectedId must be null or refer to a chapter in the document.",
      );
    }

    const previousChapters = this.previousDocument(row.chapters_json);
    const reconciled = reconcileCriterionLinks(
      previousChapters,
      normalizedChapters,
    );
    const expanded = this.expandCriterionSubchapters(
      reconciled.document,
      previousChapters,
    );
    const chapters = expanded.document;

    let selectedId = input.selectedId;
    if (selectedId !== null && !chapters.byId[selectedId]) {
      if (reconciled.removedChapterIds.includes(selectedId)) {
        selectedId = getDefaultId(chapters, null);
      } else {
        throw new ApiError(
          422,
          "validation_failed",
          "selectedId must be null or refer to a chapter in the document.",
        );
      }
    }
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
             WHERE id = ? AND owner_id = ?`,
          )
          .run(
            stats.chapterCount,
            stats.criterionCount,
            stats.checkedCount,
            timestamp,
            id,
            ownerId,
          );
      }
      this.insertNewActivity(
        id,
        [
          ...(input.activity ?? []),
          ...reconciled.activity.map((entry) => ({
            id: this.newId(),
            message: entry.message,
            chapterId: entry.chapterId,
            chapterName: entry.chapterName,
          })),
          ...expanded.activity,
        ],
        ownerId,
      );
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
      activity: this.listActivity(ownerId, id),
      stats,
      createdSubchapters: expanded.created,
      sync: reconciled.sync,
    };
  }

  private previousDocument(chaptersJson: string): ChapterDocument {
    let parsed: unknown;
    try {
      parsed = JSON.parse(chaptersJson);
    } catch {
      throw new ApiError(
        500,
        "stored_data_invalid",
        "The stored project document could not be read.",
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
    return normalized.document;
  }

  private expandCriterionSubchapters(
    input: ChapterDocument,
    previous: ChapterDocument,
  ): {
    document: ChapterDocument;
    created: CreatedCriterionSubchapter[];
    activity: CreateActivityInput[];
  } {
    let document = input;
    const created: CreatedCriterionSubchapter[] = [];
    const activity: CreateActivityInput[] = [];
    const previousCriteria = new Set<string>();
    for (const chapter of walkChapters(previous)) {
      for (const criterion of chapter.criteria) {
        previousCriteria.add(`${chapter.id}:${criterion.id}`);
      }
    }
    for (const parent of Object.values(input.byId)) {
      if (parent.finalLevel) continue;
      for (const criterion of parent.criteria) {
        if (previousCriteria.has(`${parent.id}:${criterion.id}`)) continue;
        if (criterion.chapterId) continue;
        if (!criterion.text.trim()) continue;
        const currentParent = document.byId[parent.id];
        const currentCriterion = currentParent?.criteria.find(
          (item) => item.id === criterion.id,
        );
        if (!currentParent || !currentCriterion || currentCriterion.chapterId) {
          continue;
        }
        const subchapterId = this.uniqueChapterId(document);
        const subchapter = createSubchapterFromCriterion({
          id: subchapterId,
          text: currentCriterion.text,
        });
        document = insertChapter(document, {
          ...subchapter,
          parentId: parent.id,
        });
        const withLink = document.byId[parent.id];
        if (!withLink) continue;
        document = patchChapter(document, parent.id, {
          criteria: withLink.criteria.map((item) =>
            item.id === currentCriterion.id
              ? { ...item, chapterId: subchapterId }
              : item,
          ),
        });
        created.push({
          id: subchapterId,
          parentId: parent.id,
          criterionId: currentCriterion.id,
          title: subchapter.title,
        });
        activity.push({
          id: this.newId(),
          message: "Created subchapter from success criterion",
          chapterId: subchapterId,
          chapterName: subchapter.title,
        });
      }
    }
    return { document, created, activity };
  }

  private uniqueChapterId(document: ChapterDocument): string {
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const id = this.newId();
      if (!document.byId[id]) return id;
    }
    throw new ApiError(
      500,
      "id_generation_failed",
      "A unique chapter id could not be generated.",
    );
  }

  listActivity(
    ownerId: string,
    id: string,
    options: { limit?: number; before?: number } = {},
  ): ActivityEntry[] {
    this.requireProject(ownerId, id);
    const limit = Math.min(Math.max(options.limit ?? 100, 1), 100);
    const rows = options.before
      ? (this.db
          .prepare(
            `SELECT a.*, u.display_name AS actor_name
             FROM activity_entries a
             LEFT JOIN users u ON u.id = a.actor_user_id
             WHERE a.project_id = ? AND a.sequence < ?
             ORDER BY a.sequence DESC LIMIT ?`,
          )
          .all(id, options.before, limit) as ActivityRow[])
      : (this.db
          .prepare(
            `SELECT a.*, u.display_name AS actor_name
             FROM activity_entries a
             LEFT JOIN users u ON u.id = a.actor_user_id
             WHERE a.project_id = ?
             ORDER BY a.sequence DESC LIMIT ?`,
          )
          .all(id, limit) as ActivityRow[]);
    return rows.map(activityFromRow);
  }

  appendActivity(
    ownerId: string,
    id: string,
    input: CreateActivityInput,
  ): ActivityEntry[] {
    this.requireProject(ownerId, id);
    const transaction = this.db.transaction(() => {
      this.insertNewActivity(id, [input], ownerId);
    });
    transaction();
    return this.listActivity(ownerId, id);
  }

  listAttachments(ownerId: string, id: string): AttachmentInfo[] {
    this.requireProject(ownerId, id);
    const rows = this.db
      .prepare(
        `SELECT a.*, u.display_name AS created_by_name
         FROM attachments a
         LEFT JOIN users u ON u.id = a.created_by
         WHERE a.project_id = ?
         ORDER BY a.created_at DESC, a.id DESC`,
      )
      .all(id) as AttachmentRow[];
    return rows.map(attachmentFromRow);
  }

  getAttachment(
    ownerId: string,
    id: string,
    attachmentId: string,
  ): AttachmentRecord | null {
    this.requireProject(ownerId, id);
    const row = this.db
      .prepare(
        `SELECT a.*, u.display_name AS created_by_name
         FROM attachments a
         LEFT JOIN users u ON u.id = a.created_by
         WHERE a.project_id = ? AND a.id = ?`,
      )
      .get(id, attachmentId) as AttachmentContentRow | undefined;
    if (!row) return null;
    return { ...attachmentFromRow(row), content: row.content };
  }

  addAttachment(
    ownerId: string,
    id: string,
    input: AddAttachmentInput,
  ): AttachmentInfo {
    const project = this.requireProject(ownerId, id);
    const size = input.content.byteLength;
    if (!size) {
      throw new ApiError(422, "validation_failed", "The attachment is empty.");
    }
    if (size > MAX_ATTACHMENT_BYTES) {
      throw new ApiError(
        413,
        "attachment_too_large",
        `An attachment can be at most ${MAX_ATTACHMENT_BYTES} bytes.`,
        { maxAttachmentBytes: MAX_ATTACHMENT_BYTES },
      );
    }

    const timestamp = this.now();
    const attachmentId = this.newId();
    const sha256 = createHash("sha256").update(input.content).digest("hex");
    const creator = this.db
      .prepare("SELECT display_name FROM users WHERE id = ?")
      .get(ownerId) as { display_name: string } | undefined;

    const transaction = this.db.transaction(() => {
      const count = (
        this.db
          .prepare(
            "SELECT COUNT(*) AS count FROM attachments WHERE project_id = ?",
          )
          .get(id) as { count: number }
      ).count;
      if (count >= MAX_ATTACHMENTS) {
        throw new ApiError(
          409,
          "attachment_limit_reached",
          `A project can have at most ${MAX_ATTACHMENTS} attachments.`,
          { maxAttachments: MAX_ATTACHMENTS },
        );
      }
      this.db
        .prepare(
          `INSERT INTO attachments (
            id, project_id, filename, content_type, size_bytes, sha256,
            content, created_at, created_by
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          attachmentId,
          id,
          input.filename,
          input.contentType,
          size,
          sha256,
          input.content,
          timestamp,
          ownerId,
        );
      this.activityMessage(
        id,
        `Attached ${input.filename}`,
        project.name,
        null,
        ownerId,
      );
    });
    transaction();

    return {
      id: attachmentId,
      projectId: id,
      filename: input.filename,
      contentType: input.contentType,
      sizeBytes: size,
      sha256,
      createdAt: timestamp,
      createdByName: creator?.display_name ?? null,
    };
  }

  deleteAttachment(ownerId: string, id: string, attachmentId: string): void {
    const project = this.requireProject(ownerId, id);
    const row = this.db
      .prepare(
        "SELECT filename FROM attachments WHERE project_id = ? AND id = ?",
      )
      .get(id, attachmentId) as { filename: string } | undefined;
    if (!row) {
      throw new ApiError(
        404,
        "attachment_not_found",
        "The attachment does not exist.",
      );
    }
    const transaction = this.db.transaction(() => {
      this.db
        .prepare("DELETE FROM attachments WHERE project_id = ? AND id = ?")
        .run(id, attachmentId);
      this.activityMessage(
        id,
        `Removed ${row.filename}`,
        project.name,
        null,
        ownerId,
      );
    });
    transaction();
  }

  getCoverage(ownerId: string, id: string): CoverageResult | null {
    const row = this.requireProject(ownerId, id);
    const document = this.getDocument(ownerId, id);
    if (!document) return null;
    return {
      summary: summarizeVerification(document.chapters),
      rows: getCoverageRows(document.chapters),
      testGuidelines: row.test_guidelines,
    };
  }

  exportProject(ownerId: string, id: string): ProjectExport | null {
    const row = this.requireProject(ownerId, id);
    const document = this.getDocument(ownerId, id);
    if (!document) return null;
    const workspace = createWorkspace({
      projectId: id,
      chapters: document.chapters,
      events: this.listActivity(ownerId, id),
      selectedId: document.selectedId,
    });
    return serializeProjectExport(
      projectFromRow(row),
      workspace,
      row.test_guidelines,
      this.now(),
    );
  }

  importProject(ownerId: string, raw: unknown): ImportProjectResult {
    const count = (
      this.db
        .prepare("SELECT COUNT(*) AS count FROM projects WHERE owner_id = ?")
        .get(ownerId) as {
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
    const name = uniqueProjectName(
      imported.project.name,
      this.projectNames(ownerId),
      { suffix: " (imported)" },
    );
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
      this.insertProjectRow(
        ownerId,
        project,
        stats,
        imported.testGuidelines,
        timestamp,
      );
      this.insertDocumentRow(project.id, document, selectedId, timestamp);
      for (const event of imported.workspace.events) {
        this.insertActivityRow(
          project.id,
          { ...event, actorUserId: null, actorName: null },
          null,
        );
      }
      this.activityMessage(
        project.id,
        `Imported project "${project.name}"`,
        project.name,
        null,
        ownerId,
      );
      this.trimActivity(project.id);
      this.setActiveProjectId(ownerId, project.id);
    });
    transaction();

    return {
      project: this.requireDetail(ownerId, project.id),
      issues: imported.issues,
    };
  }

  getUserState(ownerId: string): { activeProjectId: string | null } {
    return { activeProjectId: this.activeProjectId(ownerId) };
  }

  claimUnownedProjects(ownerId: string): number {
    const transaction = this.db.transaction(() => {
      const rows = this.db
        .prepare("SELECT id FROM projects WHERE owner_id IS NULL")
        .all() as Array<{ id: string }>;
      if (!rows.length) return 0;
      const ids = rows.map((row) => row.id);
      const placeholders = ids.map(() => "?").join(", ");
      this.db
        .prepare(`UPDATE projects SET owner_id = ? WHERE owner_id IS NULL`)
        .run(ownerId);
      this.db
        .prepare(
          `UPDATE activity_entries SET actor_user_id = ?
           WHERE actor_user_id IS NULL
             AND project_id IN (${placeholders})`,
        )
        .run(ownerId, ...ids);
      return rows.length;
    });
    return transaction();
  }

  migrateLegacyActiveProject(ownerId: string): void {
    const state = this.db
      .prepare("SELECT value FROM app_state WHERE key = 'active_project_id'")
      .get() as { value: string | null } | undefined;
    const candidate = state?.value ?? null;
    const existing = this.db
      .prepare("SELECT 1 FROM user_state WHERE user_id = ?")
      .get(ownerId);
    if (!existing && candidate && this.projectRow(ownerId, candidate)) {
      this.setActiveProjectId(ownerId, candidate);
    }
    this.db
      .prepare("DELETE FROM app_state WHERE key = 'active_project_id'")
      .run();
  }

  reset(): void {
    const transaction = this.db.transaction(() => {
      this.db.exec(`
        DELETE FROM activity_entries;
        DELETE FROM project_documents;
        DELETE FROM projects;
        DELETE FROM user_state;
        DELETE FROM app_state;
        DELETE FROM sqlite_sequence WHERE name = 'activity_entries';
      `);
    });
    transaction();
  }

  seedSamples(ownerId: string): boolean {
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
        this.insertProjectRow(
          ownerId,
          project,
          stats,
          sample.testGuidelines,
          timestamp,
        );
        this.insertDocumentRow(
          project.id,
          normalized.document,
          selectedId,
          timestamp,
        );
        if (!firstId) firstId = project.id;
      }
      this.setActiveProjectId(ownerId, firstId);
    });
    transaction();
    return true;
  }

  ping(): void {
    this.db.prepare("SELECT 1").get();
  }

  close(): void {
    this.db.close();
  }

  private requireDetail(ownerId: string, id: string): ProjectDetail {
    const row = this.requireProject(ownerId, id);
    return detailFromRow(row);
  }
}
