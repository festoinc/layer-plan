import { describe, expect, it } from "vitest";
import {
  ATTACHMENT_EXTENSIONS,
  attachmentTypeFor,
  formatAttachmentSize,
  MAX_ATTACHMENT_BASE64_LENGTH,
  MAX_ATTACHMENT_BYTES,
  normalizeAttachmentFilename,
  validateAttachmentContent,
  type AttachmentType,
} from "../../src/domain/attachments";

const pdf = Buffer.from("%PDF-1.4\n%%EOF\n");
const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);
const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00]);
const xls = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);

function openXml(marker: string): Buffer {
  return Buffer.concat([
    Buffer.from([0x50, 0x4b, 0x03, 0x04]),
    Buffer.from(marker),
  ]);
}

function type(extension: string): AttachmentType {
  const found = attachmentTypeFor(`file${extension}`);
  if (!found) throw new Error(`Missing attachment type for ${extension}`);
  return found;
}

describe("attachment domain", () => {
  it("maps supported extensions to content types", () => {
    expect(ATTACHMENT_EXTENSIONS).toEqual([
      ".pdf",
      ".csv",
      ".tsv",
      ".txt",
      ".md",
      ".log",
      ".json",
      ".yaml",
      ".yml",
      ".toon",
      ".jpg",
      ".jpeg",
      ".png",
      ".xls",
      ".xlsx",
      ".docx",
      ".pptx",
    ]);
    expect(type(".pdf").contentType).toBe("application/pdf");
    expect(type(".csv").contentType).toBe("text/csv");
    expect(type(".tsv").contentType).toBe("text/tab-separated-values");
    expect(type(".txt").contentType).toBe("text/plain");
    expect(type(".md").contentType).toBe("text/markdown");
    expect(type(".log").contentType).toBe("text/plain");
    expect(type(".json").contentType).toBe("application/json");
    expect(type(".yaml").contentType).toBe("application/yaml");
    expect(type(".yml").contentType).toBe("application/yaml");
    expect(type(".toon").contentType).toBe("text/toon");
    expect(type(".jpg").contentType).toBe("image/jpeg");
    expect(type(".jpeg").contentType).toBe("image/jpeg");
    expect(type(".png").contentType).toBe("image/png");
    expect(type(".xls").contentType).toBe("application/vnd.ms-excel");
    expect(type(".xlsx").contentType).toContain("spreadsheetml.sheet");
    expect(type(".docx").contentType).toContain("wordprocessingml.document");
    expect(type(".pptx").contentType).toContain("presentationml.presentation");
    expect(attachmentTypeFor("sheet.xlsx")).not.toBeNull();
    expect(attachmentTypeFor("archive.zip")).toBeNull();
    expect(attachmentTypeFor("page.html")).toBeNull();
  });

  it("normalizes filenames without path traversal", () => {
    expect(normalizeAttachmentFilename("report.pdf")).toBe("report.pdf");
    expect(normalizeAttachmentFilename("../private/report.pdf")).toBe(
      "report.pdf",
    );
    expect(normalizeAttachmentFilename("C:\\files\\report.pdf")).toBe(
      "report.pdf",
    );
    expect(normalizeAttachmentFilename("  report.pdf  ")).toBe("report.pdf");
    expect(normalizeAttachmentFilename("bad\u0000name.pdf")).toBe(
      "badname.pdf",
    );
    expect(normalizeAttachmentFilename("")).toBeNull();
    expect(normalizeAttachmentFilename("..")).toBeNull();
    expect(normalizeAttachmentFilename("a".repeat(256))).toBeNull();
  });

  it("checks binary signatures", () => {
    expect(validateAttachmentContent(type(".pdf"), pdf)).toBeNull();
    expect(validateAttachmentContent(type(".png"), png)).toBeNull();
    expect(validateAttachmentContent(type(".jpg"), jpeg)).toBeNull();
    expect(validateAttachmentContent(type(".xls"), xls)).toBeNull();
    expect(
      validateAttachmentContent(type(".pdf"), Buffer.from("no")),
    ).toContain("PDF");
    expect(validateAttachmentContent(type(".png"), Buffer.alloc(0))).toContain(
      "empty",
    );
  });

  it("checks text formats as UTF-8 without NUL bytes", () => {
    for (const extension of [
      ".csv",
      ".tsv",
      ".txt",
      ".md",
      ".log",
      ".json",
      ".yaml",
      ".yml",
      ".toon",
    ]) {
      expect(
        validateAttachmentContent(
          type(extension),
          Buffer.from("name,value\nalpha,1\n"),
        ),
      ).toBeNull();
    }
    expect(
      validateAttachmentContent(type(".json"), Buffer.from([0x61, 0x00, 0x62])),
    ).toContain("binary");
    expect(
      validateAttachmentContent(type(".md"), Buffer.from([0xff, 0xfe, 0xfd])),
    ).toContain("UTF-8");
  });

  it("checks the expected part inside Open XML packages", () => {
    expect(
      validateAttachmentContent(type(".xlsx"), openXml("xl/workbook.xml")),
    ).toBeNull();
    expect(
      validateAttachmentContent(type(".docx"), openXml("word/document.xml")),
    ).toBeNull();
    expect(
      validateAttachmentContent(type(".pptx"), openXml("ppt/presentation.xml")),
    ).toBeNull();
    expect(
      validateAttachmentContent(type(".xlsx"), openXml("word/document.xml")),
    ).toContain("Excel");
    expect(
      validateAttachmentContent(type(".docx"), Buffer.from("plain text")),
    ).toContain("Word");
    expect(
      validateAttachmentContent(type(".pptx"), openXml("xl/workbook.xml")),
    ).toContain("PowerPoint");
  });

  it("exposes the limits and a readable formatter", () => {
    expect(MAX_ATTACHMENT_BYTES).toBe(10 * 1024 * 1024);
    expect(MAX_ATTACHMENT_BASE64_LENGTH).toBe(
      Math.ceil(MAX_ATTACHMENT_BYTES / 3) * 4,
    );
    expect(formatAttachmentSize(512)).toBe("512 B");
    expect(formatAttachmentSize(2048)).toBe("2.0 KB");
    expect(formatAttachmentSize(2 * 1024 * 1024)).toBe("2.0 MB");
  });
});
