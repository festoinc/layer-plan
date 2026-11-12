import type { ActivityEntry } from "../domain/activity";
import type { ChapterDocument } from "../domain/chapters";
import type { ProjectStats, ProjectSummary } from "../domain/projects";
import type { CoverageRow, VerificationSummary } from "../domain/verification";

export interface ProjectDetail extends ProjectSummary {
  testGuidelines: string;
  metadataRevision: number;
  documentRevision: number;
}

export interface ProjectListResponse {
  projects: ProjectSummary[];
  activeProjectId: string | null;
}

export interface DocumentResponse {
  schemaVersion: number;
  projectId: string;
  revision: number;
  updatedAt: string;
  chapters: ChapterDocument;
  selectedId: string | null;
}

export interface DocumentWriteResponse extends DocumentResponse {
  stats: ProjectStats;
  activity: ActivityEntry[];
}

export interface ActivityListResponse {
  events: ActivityEntry[];
  nextBefore: number | null;
}

export interface CoverageResponse {
  summary: VerificationSummary;
  rows: CoverageRow[];
  testGuidelines: string;
}

export interface ImportProjectResponse {
  project: ProjectDetail;
  issues: string[];
}

export type ApiResult<T> =
  { ok: true; value: T; issues: string[] } | { ok: false; issues: string[] };

export type NoticeLevel = "info" | "warning" | "error";

export interface ApiNotice {
  level: NoticeLevel;
  message: string;
}

export type WorkspaceStatusState =
  "loading" | "saved" | "pending" | "error" | "conflict";

export interface WorkspaceStatus {
  state: WorkspaceStatusState;
  message: string;
}
