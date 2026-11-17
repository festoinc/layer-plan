import { apiRequest, apiRequestBlob } from "./client";
import type {
  AttachmentInfo,
  AttachmentListResponse,
} from "../domain/attachments";

function projectPath(projectId: string): string {
  return `/projects/${encodeURIComponent(projectId)}/attachments`;
}

function attachmentPath(projectId: string, attachmentId: string): string {
  return `${projectPath(projectId)}/${encodeURIComponent(attachmentId)}`;
}

export async function listAttachments(
  projectId: string,
): Promise<AttachmentListResponse> {
  const response = await apiRequest<AttachmentListResponse>(
    projectPath(projectId),
  );
  return response.data;
}

export async function uploadAttachment(
  projectId: string,
  input: { filename: string; contentBase64: string },
): Promise<AttachmentInfo> {
  const response = await apiRequest<AttachmentInfo>(projectPath(projectId), {
    method: "POST",
    body: input,
    timeoutMs: 120_000,
  });
  return response.data;
}

export async function deleteAttachment(
  projectId: string,
  attachmentId: string,
): Promise<void> {
  await apiRequest<void>(attachmentPath(projectId, attachmentId), {
    method: "DELETE",
  });
}

export async function downloadAttachment(
  projectId: string,
  attachmentId: string,
): Promise<{ blob: Blob; filename: string | null }> {
  return apiRequestBlob(`${attachmentPath(projectId, attachmentId)}/content`);
}

export async function fileToBase64(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(
      ...bytes.subarray(offset, offset + chunkSize),
    );
  }
  return btoa(binary);
}
