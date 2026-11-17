import type { ActivityEntry } from "../domain/activity";
import type { ChapterDocument } from "../domain/chapters";
import type { ProjectStats, ProjectSummary } from "../domain/projects";
import type { CoverageRow, VerificationSummary } from "../domain/verification";

export type {
  SearchField,
  SearchMatch,
  SearchPathItem,
  SearchResponse,
  SearchResult,
} from "../domain/search";

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

export type UserRole = "super_admin" | "member";

export interface AuthUser {
  id: string;
  email: string;
  displayName: string;
  role: UserRole;
  createdAt: string;
  updatedAt: string;
  disabledAt: string | null;
}

export interface SessionInfo {
  id: string;
  createdAt: string;
  lastSeenAt: string;
  expiresAt: string;
  userAgent: string | null;
  current?: boolean;
}

export interface LoginResponse {
  user: AuthUser;
  session: SessionInfo;
}

export interface MeResponse {
  user: AuthUser;
}

export interface SessionsResponse {
  sessions: SessionInfo[];
}

export interface ApiTokenInfo {
  id: string;
  projectId: string;
  name: string;
  prefix: string;
  scopes: string[];
  createdAt: string;
  lastUsedAt: string | null;
  expiresAt: string | null;
  revokedAt: string | null;
}

export interface TokensResponse {
  tokens: ApiTokenInfo[];
}

export interface CreateTokenResponse {
  token: string;
  tokenInfo: ApiTokenInfo;
}

export interface OAuthConsentProject {
  id: string;
  name: string;
  color: string;
}

export interface OAuthConsentRequest {
  id: string;
  clientId: string;
  clientName: string;
  redirectUri: string;
  redirectHost: string;
  scopes: string[];
  expiresAt: string;
}

export interface OAuthConsentResponse {
  request: OAuthConsentRequest;
  projects: OAuthConsentProject[];
}

export interface OAuthConsentDecision {
  decision: "approve" | "deny";
  projectId?: string;
  scopes?: Array<"read" | "write">;
}

export interface OAuthConsentDecisionResponse {
  redirectTo: string;
}

export interface OAuthGrantInfo {
  id: string;
  clientId: string;
  clientName: string;
  scopes: string[];
  createdAt: string;
  lastUsedAt: string | null;
  expiresAt: string;
  revokedAt: string | null;
}

export interface OAuthGrantsResponse {
  grants: OAuthGrantInfo[];
}

export interface UsersResponse {
  users: AuthUser[];
}

export interface UserResponse {
  user: AuthUser;
}
