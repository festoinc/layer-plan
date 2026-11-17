import { describe, expect, it } from "vitest";
import {
  ATTACHMENT_EXTENSIONS,
  attachmentTypeFor,
  formatAttachmentSize,
  MAX_ATTACHMENT_BASE64_LENGTH,
  MAX_ATTACHMENT_BYTES,
  normalizeAttachmentFilename,
  validateAttachmentContent,
} from "../../src/domain/attachments";

const pdf = Buffer.from("%PDF-1.4\n%%EOF\n");
const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);
const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00]);
const xls = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);

describe("attachment domain", () => {
  it("maps supported extensions to content types", () => {
    expect(ATTACHMENT_EXTENSIONS).toEqual([
      ".pdf",
      ".csv",
      ".jpg",
      ".jpeg",
      ".png",
      ".xls",
    ]);
    expect(attachmentTypeFor("Report.PDF")?.contentType).toBe(
      "application/pdf",
    );
    expect(attachmentTypeFor("data.csv")?.contentType).toBe("text/csv");
    expect(attachmentTypeFor("photo.JPEG")?.contentType).toBe("image/jpeg");
    expect(attachmentTypeFor("photo.png")?.contentType).toBe("image/png");
    expect(attachmentTypeFor("sheet.xls")?.contentType).toBe(
      "application/vnd.ms-excel",
    );
    expect(attachmentTypeFor("sheet.xlsx")).toBeNull();
    expect(attachmentTypeFor("archive.zip")).toBeNull();
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

  it("checks content signatures and CSV text", () => {
    expect(validateAttachmentContent(attachmentTypeFor("a.pdf")!, pdf)).toBe(
      null,
    );
    expect(validateAttachmentContent(attachmentTypeFor("a.png")!, png)).toBe(
      null,
    );
    expect(validateAttachmentContent(attachmentTypeFor("a.jpg")!, jpeg)).toBe(
      null,
    );
    expect(validateAttachmentContent(attachmentTypeFor("a.xls")!, xls)).toBe(
      null,
    );
    expect(
      validateAttachmentContent(
        attachmentTypeFor("a.csv")!,
        Buffer.from("name,value\nalpha,1\n"),
      ),
    ).toBeNull();
    expect(
      validateAttachmentContent(
        attachmentTypeFor("a.csv")!,
        Buffer.from([0x61, 0x00, 0x62]),
      ),
    ).toContain("binary");
    expect(
      validateAttachmentContent(
        attachmentTypeFor("a.csv")!,
        Buffer.from([0xff, 0xfe, 0xfd]),
      ),
    ).toContain("UTF-8");
    expect(
      validateAttachmentContent(attachmentTypeFor("a.pdf")!, Buffer.from("no")),
    ).toContain("PDF");
    expect(
      validateAttachmentContent(attachmentTypeFor("a.png")!, Buffer.alloc(0)),
    ).toContain("empty");
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
