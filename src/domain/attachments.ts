export const MAX_ATTACHMENTS = 20;
export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;
export const MAX_ATTACHMENT_FILENAME_LENGTH = 255;

/**
 * Base64 is 4 bytes for every 3 input bytes. The route body limit adds a small
 * amount of JSON and filename overhead on top of this value.
 */
export const MAX_ATTACHMENT_BASE64_LENGTH =
  Math.ceil(MAX_ATTACHMENT_BYTES / 3) * 4;

export interface AttachmentType {
  extension: string;
  contentType: string;
  label: string;
}

export const ATTACHMENT_TYPES: AttachmentType[] = [
  { extension: ".pdf", contentType: "application/pdf", label: "PDF" },
  { extension: ".csv", contentType: "text/csv", label: "CSV" },
  {
    extension: ".tsv",
    contentType: "text/tab-separated-values",
    label: "TSV",
  },
  { extension: ".txt", contentType: "text/plain", label: "Text" },
  { extension: ".md", contentType: "text/markdown", label: "Markdown" },
  { extension: ".log", contentType: "text/plain", label: "Log" },
  { extension: ".json", contentType: "application/json", label: "JSON" },
  { extension: ".yaml", contentType: "application/yaml", label: "YAML" },
  { extension: ".yml", contentType: "application/yaml", label: "YAML" },
  { extension: ".toon", contentType: "text/toon", label: "TOON" },
  { extension: ".jpg", contentType: "image/jpeg", label: "JPEG" },
  { extension: ".jpeg", contentType: "image/jpeg", label: "JPEG" },
  { extension: ".png", contentType: "image/png", label: "PNG" },
  {
    extension: ".xls",
    contentType: "application/vnd.ms-excel",
    label: "Excel",
  },
  {
    extension: ".xlsx",
    contentType:
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    label: "Excel",
  },
  {
    extension: ".docx",
    contentType:
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    label: "Word",
  },
  {
    extension: ".pptx",
    contentType:
      "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    label: "PowerPoint",
  },
];

export const ATTACHMENT_EXTENSIONS = ATTACHMENT_TYPES.map(
  (type) => type.extension,
);

export const ATTACHMENT_ACCEPT = ATTACHMENT_EXTENSIONS.join(",");

export interface AttachmentInfo {
  id: string;
  projectId: string;
  filename: string;
  contentType: string;
  sizeBytes: number;
  sha256: string;
  createdAt: string;
  createdByName: string | null;
}

export interface AttachmentListResponse {
  attachments: AttachmentInfo[];
  maxAttachments: number;
  maxAttachmentBytes: number;
  allowedExtensions: string[];
}

export interface AttachmentUploadInput {
  filename: string;
  contentBase64: string;
}

export function attachmentTypeFor(filename: string): AttachmentType | null {
  const lower = filename.toLowerCase();
  return (
    ATTACHMENT_TYPES.find((type) => lower.endsWith(type.extension)) ?? null
  );
}

/**
 * Keep only the basename, strip control characters and reject names that are
 * empty, dot-only or too long. The original character case is preserved.
 */
export function normalizeAttachmentFilename(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const path = raw.replace(/\\/g, "/");
  const base = Array.from(path.slice(path.lastIndexOf("/") + 1))
    .filter((character) => {
      const code = character.codePointAt(0) ?? 0;
      return code >= 0x20 && code !== 0x7f;
    })
    .join("")
    .trim();
  if (!base || base === "." || base === "..") return null;
  if (base.length > MAX_ATTACHMENT_FILENAME_LENGTH) return null;
  return base;
}

function startsWith(bytes: Uint8Array, signature: number[]): boolean {
  if (bytes.length < signature.length) return false;
  return signature.every((value, index) => bytes[index] === value);
}

const PDF_SIGNATURE = [0x25, 0x50, 0x44, 0x46, 0x2d];
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const JPEG_SIGNATURE = [0xff, 0xd8, 0xff];
const XLS_SIGNATURE = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];
const ZIP_SIGNATURE = [0x50, 0x4b, 0x03, 0x04];

const TEXT_CONTENT_TYPES = new Set([
  "text/plain",
  "text/csv",
  "text/tab-separated-values",
  "text/markdown",
  "text/toon",
  "application/json",
  "application/yaml",
]);

function containsAscii(bytes: Uint8Array, value: string): boolean {
  const pattern = Array.from(value, (character) => character.charCodeAt(0));
  const last = bytes.length - pattern.length;
  outer: for (let offset = 0; offset <= last; offset += 1) {
    for (let index = 0; index < pattern.length; index += 1) {
      if (bytes[offset + index] !== pattern[index]) continue outer;
    }
    return true;
  }
  return false;
}

function validateText(bytes: Uint8Array): string | null {
  if (bytes.includes(0)) return "The file contains binary data.";
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return "The file is not valid UTF-8 text.";
  }
  return null;
}

function validateOpenXml(
  bytes: Uint8Array,
  marker: string,
  label: string,
): string | null {
  if (!startsWith(bytes, ZIP_SIGNATURE) || !containsAscii(bytes, marker)) {
    return `The file does not look like a ${label} document.`;
  }
  return null;
}

/**
 * Return a human-readable problem when the bytes do not match the extension,
 * or null when they do. Text formats are checked as UTF-8 without NUL bytes.
 */
export function validateAttachmentContent(
  type: AttachmentType,
  bytes: Uint8Array,
): string | null {
  if (!bytes.length) return "The attachment is empty.";

  switch (type.contentType) {
    case "application/pdf":
      return startsWith(bytes, PDF_SIGNATURE)
        ? null
        : "The file does not look like a PDF document.";
    case "image/png":
      return startsWith(bytes, PNG_SIGNATURE)
        ? null
        : "The file does not look like a PNG image.";
    case "image/jpeg":
      return startsWith(bytes, JPEG_SIGNATURE)
        ? null
        : "The file does not look like a JPEG image.";
    case "application/vnd.ms-excel":
      return startsWith(bytes, XLS_SIGNATURE)
        ? null
        : "The file does not look like an Excel workbook.";
    case "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet":
      return validateOpenXml(bytes, "xl/workbook.xml", "Excel");
    case "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
      return validateOpenXml(bytes, "word/document.xml", "Word");
    case "application/vnd.openxmlformats-officedocument.presentationml.presentation":
      return validateOpenXml(bytes, "ppt/presentation.xml", "PowerPoint");
    default:
      return TEXT_CONTENT_TYPES.has(type.contentType)
        ? validateText(bytes)
        : "The attachment type is not supported.";
  }
}

export function formatAttachmentSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(bytes < 10 * 1024 ? 1 : 0)} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
