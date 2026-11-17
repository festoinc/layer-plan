import type { SearchResponse } from "../domain/search";
import { apiRequest } from "./client";

export interface SearchProjectOptions {
  limit?: number;
  offset?: number;
  signal?: AbortSignal;
}

export async function searchProject(
  projectId: string,
  query: string,
  options: SearchProjectOptions = {},
): Promise<SearchResponse> {
  const params = new URLSearchParams({ q: query });
  if (options.limit !== undefined) params.set("limit", String(options.limit));
  if (options.offset !== undefined) {
    params.set("offset", String(options.offset));
  }
  const response = await apiRequest<SearchResponse>(
    `/projects/${encodeURIComponent(projectId)}/search?${params.toString()}`,
    { signal: options.signal },
  );
  return response.data;
}
