import type { FastifyInstance } from "fastify";
import {
  attachmentTypeFor,
  MAX_ATTACHMENTS,
  MAX_ATTACHMENT_BYTES,
  normalizeAttachmentFilename,
  validateAttachmentContent,
  ATTACHMENT_EXTENSIONS,
  type AttachmentInfo,
  type AttachmentListResponse,
} from "../../../src/domain/attachments";
import type { AuthHooks } from "../../auth/middleware";
import type { ProjectStore } from "../../db/store";
import { ATTACHMENT_UPLOAD_BODY_LIMIT } from "../attachmentLimits";
import { ApiError } from "../errors";
import { parseBody, uploadAttachmentSchema } from "../schemas";

interface ProjectParams {
  id: string;
}

interface AttachmentParams extends ProjectParams {
  attachmentId: string;
}

function invalidBase64(): ApiError {
  return new ApiError(
    422,
    "validation_failed",
    "contentBase64 must be valid base64.",
    { path: "contentBase64" },
  );
}

function decodeBase64(value: string): Buffer {
  const compact = value.replace(/\s+/g, "");
  if (!compact || !/^[A-Za-z0-9+/]*={0,2}$/.test(compact)) {
    throw invalidBase64();
  }
  const padded = compact.padEnd(Math.ceil(compact.length / 4) * 4, "=");
  if (padded.length % 4 !== 0) throw invalidBase64();
  const buffer = Buffer.from(padded, "base64");
  const canonical = buffer.toString("base64").replace(/=+$/, "");
  if (canonical !== compact.replace(/=+$/, "")) throw invalidBase64();
  return buffer;
}

function contentDisposition(filename: string): string {
  const fallback = filename
    .replace(/[^\x20-\x7e]/g, "_")
    .replace(/["\\]/g, "_");
  const encoded = encodeURIComponent(filename).replace(
    /['()]/g,
    (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encoded}`;
}

function notFound(): ApiError {
  return new ApiError(
    404,
    "attachment_not_found",
    "The attachment does not exist.",
  );
}

export function registerAttachmentRoutes(
  app: FastifyInstance,
  store: ProjectStore,
  hooks: AuthHooks,
) {
  app.get<{ Params: ProjectParams }>(
    "/api/v1/projects/:id/attachments",
    { preHandler: hooks.requireAuth },
    async (request): Promise<AttachmentListResponse> => {
      const attachments = store.listAttachments(
        request.auth!.user.id,
        request.params.id,
      );
      return {
        attachments,
        maxAttachments: MAX_ATTACHMENTS,
        maxAttachmentBytes: MAX_ATTACHMENT_BYTES,
        allowedExtensions: ATTACHMENT_EXTENSIONS,
      };
    },
  );

  app.post<{ Params: ProjectParams }>(
    "/api/v1/projects/:id/attachments",
    {
      preHandler: hooks.requireAuth,
      bodyLimit: ATTACHMENT_UPLOAD_BODY_LIMIT,
    },
    async (request, reply) => {
      const input = parseBody(uploadAttachmentSchema, request.body);
      const filename = normalizeAttachmentFilename(input.filename);
      if (!filename) {
        throw new ApiError(
          422,
          "validation_failed",
          "The attachment filename is invalid.",
          { path: "filename" },
        );
      }
      const type = attachmentTypeFor(filename);
      if (!type) {
        throw new ApiError(
          415,
          "unsupported_attachment_type",
          "Only PDF, CSV, JPEG, PNG and XLS files can be attached.",
          { allowedExtensions: ATTACHMENT_EXTENSIONS },
        );
      }
      const content = decodeBase64(input.contentBase64);
      if (content.byteLength > MAX_ATTACHMENT_BYTES) {
        throw new ApiError(
          413,
          "attachment_too_large",
          "An attachment can be at most 10 MiB.",
          { maxAttachmentBytes: MAX_ATTACHMENT_BYTES },
        );
      }
      const problem = validateAttachmentContent(type, content);
      if (problem) {
        throw new ApiError(415, "unsupported_attachment_type", problem, {
          allowedExtensions: ATTACHMENT_EXTENSIONS,
        });
      }

      const attachment: AttachmentInfo = store.addAttachment(
        request.auth!.user.id,
        request.params.id,
        { filename, contentType: type.contentType, content },
      );
      reply.header(
        "Location",
        `/api/v1/projects/${encodeURIComponent(request.params.id)}/attachments/${encodeURIComponent(attachment.id)}`,
      );
      return reply.code(201).send(attachment);
    },
  );

  app.get<{ Params: AttachmentParams }>(
    "/api/v1/projects/:id/attachments/:attachmentId",
    { preHandler: hooks.requireAuth },
    async (request) => {
      const attachment = store.getAttachment(
        request.auth!.user.id,
        request.params.id,
        request.params.attachmentId,
      );
      if (!attachment) throw notFound();
      const { content: _content, ...info } = attachment;
      return info;
    },
  );

  app.get<{ Params: AttachmentParams }>(
    "/api/v1/projects/:id/attachments/:attachmentId/content",
    { preHandler: hooks.requireAuth },
    async (request, reply) => {
      const attachment = store.getAttachment(
        request.auth!.user.id,
        request.params.id,
        request.params.attachmentId,
      );
      if (!attachment) throw notFound();
      reply
        .type(attachment.contentType)
        .header("Content-Length", String(attachment.sizeBytes))
        .header("Content-Disposition", contentDisposition(attachment.filename))
        .header("X-Content-Type-Options", "nosniff")
        .header("Cache-Control", "no-store");
      return reply.send(attachment.content);
    },
  );

  app.delete<{ Params: AttachmentParams }>(
    "/api/v1/projects/:id/attachments/:attachmentId",
    { preHandler: hooks.requireAuth },
    async (request, reply) => {
      store.deleteAttachment(
        request.auth!.user.id,
        request.params.id,
        request.params.attachmentId,
      );
      return reply.code(204).send();
    },
  );
}
