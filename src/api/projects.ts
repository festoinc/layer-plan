import type {
  ProjectInput,
  ProjectPatch,
  ProjectSummary,
} from "../domain/projects";
import { apiRequest } from "./client";
import type {
  ImportProjectResponse,
  ProjectDetail,
  ProjectListResponse,
} from "./types";

export async function listProjects(): Promise<ProjectListResponse> {
  const response = await apiRequest<ProjectListResponse>("/projects");
  return response.data;
}

export async function getProject(id: string): Promise<ProjectDetail> {
  const response = await apiRequest<ProjectDetail>(
    `/projects/${encodeURIComponent(id)}`,
  );
  return response.data;
}

export async function createProject(
  input: ProjectInput,
): Promise<ProjectDetail> {
  const response = await apiRequest<ProjectDetail>("/projects", {
    method: "POST",
    body: input,
  });
  return response.data;
}

export async function updateProject(
  id: string,
  patch: ProjectPatch,
  metadataRevision: number,
): Promise<ProjectDetail> {
  const response = await apiRequest<ProjectDetail>(
    `/projects/${encodeURIComponent(id)}`,
    {
      method: "PATCH",
      body: patch,
      etag: metadataRevision,
    },
  );
  return response.data;
}

export async function deleteProject(
  id: string,
  metadataRevision: number,
): Promise<{ activeProjectId: string | null }> {
  const response = await apiRequest<{ activeProjectId: string | null }>(
    `/projects/${encodeURIComponent(id)}`,
    {
      method: "DELETE",
      etag: metadataRevision,
    },
  );
  return response.data;
}

export async function duplicateProject(id: string): Promise<ProjectDetail> {
  const response = await apiRequest<ProjectDetail>(
    `/projects/${encodeURIComponent(id)}/duplicate`,
    { method: "POST" },
  );
  return response.data;
}

export async function activateProject(
  id: string,
): Promise<{ activeProjectId: string | null }> {
  const response = await apiRequest<{ activeProjectId: string | null }>(
    `/projects/${encodeURIComponent(id)}/activate`,
    { method: "POST" },
  );
  return response.data;
}

export async function fetchProjectExport(id: string): Promise<string> {
  const response = await fetch(
    `${import.meta.env.VITE_API_URL ?? "/api/v1"}/projects/${encodeURIComponent(id)}/export`,
  );
  if (!response.ok) {
    throw new Error(`The project could not be exported (${response.status}).`);
  }
  return response.text();
}

export async function importProject(
  text: string,
): Promise<ImportProjectResponse> {
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    throw new Error("The selected file is not valid JSON.");
  }
  const response = await apiRequest<ImportProjectResponse>("/projects/import", {
    method: "POST",
    body,
  });
  return response.data;
}

export function projectSummary(project: ProjectDetail): ProjectSummary {
  const {
    testGuidelines: _testGuidelines,
    metadataRevision: _metadataRevision,
    documentRevision: _documentRevision,
    ...summary
  } = project;
  return summary;
}
