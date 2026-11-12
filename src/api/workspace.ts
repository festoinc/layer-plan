import type { ActivityEntry, CreateActivityInput } from "../domain/activity";
import type { ChapterDocument } from "../domain/chapters";
import { apiRequest } from "./client";
import type {
  ActivityListResponse,
  DocumentResponse,
  DocumentWriteResponse,
} from "./types";

export interface SaveDocumentBody {
  chapters: ChapterDocument;
  selectedId: string | null;
  activity?: CreateActivityInput[];
}

export async function getDocument(id: string): Promise<DocumentResponse> {
  const response = await apiRequest<DocumentResponse>(
    `/projects/${encodeURIComponent(id)}/document`,
  );
  return response.data;
}

export async function getActivity(id: string): Promise<ActivityEntry[]> {
  const response = await apiRequest<ActivityListResponse>(
    `/projects/${encodeURIComponent(id)}/activity`,
  );
  return response.data.events;
}

export async function saveDocument(
  id: string,
  revision: number,
  body: SaveDocumentBody,
  options: { keepalive?: boolean } = {},
): Promise<DocumentWriteResponse> {
  const response = await apiRequest<DocumentWriteResponse>(
    `/projects/${encodeURIComponent(id)}/document`,
    {
      method: "PUT",
      body,
      etag: revision,
      keepalive: options.keepalive,
    },
  );
  return response.data;
}
