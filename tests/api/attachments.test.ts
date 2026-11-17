import { afterEach, describe, expect, it } from "vitest";
import { MAX_ATTACHMENT_BYTES } from "../../src/domain/attachments";
import {
  authHeaders,
  createTestApi,
  docRequest,
  json,
  TEST_SUPER_ADMIN,
  type TestApi,
} from "./helpers";

let api: TestApi | null = null;
afterEach(async () => {
  await api?.close();
  api = null;
});

const PDF = Buffer.from("%PDF-1.4\n1 0 obj\n<<>>\nendobj\n%%EOF\n");
const PNG = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x01,
]);

async function superCookie(testApi: TestApi): Promise<string> {
  return (
    await testApi.login(TEST_SUPER_ADMIN.email, TEST_SUPER_ADMIN.password)
  ).cookie;
}

function upload(
  testApi: TestApi,
  cookie: string,
  projectId: string,
  filename: string,
  content: Buffer,
  contentBase64 = content.toString("base64"),
) {
  return testApi.app.inject({
    method: "POST",
    url: `/api/v1/projects/${projectId}/attachments`,
    ...docRequest({ filename, contentBase64 }, authHeaders(cookie)),
  });
}

describe("attachments API", () => {
  it("uploads, lists, downloads and deletes an attachment without changing the document revision", async () => {
    api = await createTestApi();
    const cookie = await superCookie(api);
    const documentBefore = await api.app.inject({
      method: "GET",
      url: "/api/v1/projects/website/document",
      headers: authHeaders(cookie),
    });
    const etagBefore = documentBefore.headers.etag;

    const created = await upload(
      api,
      cookie,
      "website",
      "requirements.PDF",
      PDF,
    );
    expect(created.statusCode).toBe(201);
    expect(created.headers.location).toBe(
      `/api/v1/projects/website/attachments/${json(created).id}`,
    );
    const attachment = json(created);
    expect(attachment).toMatchObject({
      projectId: "website",
      filename: "requirements.PDF",
      contentType: "application/pdf",
      sizeBytes: PDF.length,
      createdByName: "Super Admin",
    });
    expect(attachment.sha256).toMatch(/^[a-f0-9]{64}$/);

    const documentAfter = await api.app.inject({
      method: "GET",
      url: "/api/v1/projects/website/document",
      headers: authHeaders(cookie),
    });
    expect(documentAfter.headers.etag).toBe(etagBefore);

    const list = await api.app.inject({
      method: "GET",
      url: "/api/v1/projects/website/attachments",
      headers: authHeaders(cookie),
    });
    expect(list.statusCode).toBe(200);
    expect(json(list)).toMatchObject({
      maxAttachments: 20,
      maxAttachmentBytes: MAX_ATTACHMENT_BYTES,
      allowedExtensions: [
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
      ],
    });
    expect(json(list).attachments).toHaveLength(1);
    expect(json(list).attachments[0].id).toBe(attachment.id);

    const metadata = await api.app.inject({
      method: "GET",
      url: `/api/v1/projects/website/attachments/${attachment.id}`,
      headers: authHeaders(cookie),
    });
    expect(metadata.statusCode).toBe(200);
    expect(json(metadata).filename).toBe("requirements.PDF");
    expect(json(metadata).content).toBeUndefined();

    const download = await api.app.inject({
      method: "GET",
      url: `/api/v1/projects/website/attachments/${attachment.id}/content`,
      headers: authHeaders(cookie),
    });
    expect(download.statusCode).toBe(200);
    expect(download.headers["content-type"]).toContain("application/pdf");
    expect(download.headers["content-disposition"]).toContain(
      'attachment; filename="requirements.PDF"',
    );
    expect(download.headers["cache-control"]).toBe("no-store");
    expect(download.headers["x-content-type-options"]).toBe("nosniff");
    expect(download.rawPayload.equals(PDF)).toBe(true);

    const activity = await api.app.inject({
      method: "GET",
      url: "/api/v1/projects/website/activity",
      headers: authHeaders(cookie),
    });
    expect(json(activity).events[0].message).toBe("Attached requirements.PDF");
    expect(json(activity).events[0].actorName).toBe("Super Admin");

    const removed = await api.app.inject({
      method: "DELETE",
      url: `/api/v1/projects/website/attachments/${attachment.id}`,
      headers: authHeaders(cookie),
    });
    expect(removed.statusCode).toBe(204);

    const missing = await api.app.inject({
      method: "GET",
      url: `/api/v1/projects/website/attachments/${attachment.id}/content`,
      headers: authHeaders(cookie),
    });
    expect(missing.statusCode).toBe(404);
    expect(json(missing).error.code).toBe("attachment_not_found");

    const removedAgain = await api.app.inject({
      method: "DELETE",
      url: `/api/v1/projects/website/attachments/${attachment.id}`,
      headers: authHeaders(cookie),
    });
    expect(removedAgain.statusCode).toBe(404);

    const activityAfter = await api.app.inject({
      method: "GET",
      url: "/api/v1/projects/website/activity",
      headers: authHeaders(cookie),
    });
    expect(json(activityAfter).events[0].message).toBe(
      "Removed requirements.PDF",
    );
  });

  it("accepts text, data and Open XML attachments", async () => {
    api = await createTestApi();
    const cookie = await superCookie(api);

    const textFormats: Array<[string, string]> = [
      [".txt", "plain text\n"],
      [".md", "# Markdown\n"],
      [".tsv", "name\tvalue\nalpha\t1\n"],
      [".json", '{"name":"alpha"}\n'],
      [".yaml", "name: alpha\n"],
      [".yml", "name: alpha\n"],
      [".toon", "name: alpha\n"],
      [".log", "started\n"],
    ];
    for (const [extension, content] of textFormats) {
      const response = await upload(
        api,
        cookie,
        "website",
        `sample${extension}`,
        Buffer.from(content),
      );
      expect(response.statusCode, extension).toBe(201);
    }

    const openXml = (marker: string) =>
      Buffer.concat([
        Buffer.from([0x50, 0x4b, 0x03, 0x04]),
        Buffer.from(marker),
      ]);
    for (const [filename, marker] of [
      ["book.xlsx", "xl/workbook.xml"],
      ["letter.docx", "word/document.xml"],
      ["deck.pptx", "ppt/presentation.xml"],
    ] as const) {
      const response = await upload(
        api,
        cookie,
        "website",
        filename,
        openXml(marker),
      );
      expect(response.statusCode, filename).toBe(201);
    }

    const list = await api.app.inject({
      method: "GET",
      url: "/api/v1/projects/website/attachments",
      headers: authHeaders(cookie),
    });
    expect(json(list).attachments).toHaveLength(11);
    const contentTypes = json(list).attachments.map(
      (attachment: { contentType: string }) => attachment.contentType,
    );
    expect(contentTypes).toEqual(
      expect.arrayContaining([
        "text/plain",
        "text/markdown",
        "text/tab-separated-values",
        "application/json",
        "application/yaml",
        "text/toon",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      ]),
    );
  });

  it("rejects unsupported types, mismatched content and invalid base64", async () => {
    api = await createTestApi();
    const cookie = await superCookie(api);

    const unsupported = await upload(
      api,
      cookie,
      "website",
      "animation.gif",
      Buffer.from("GIF89a"),
    );
    expect(unsupported.statusCode).toBe(415);
    expect(json(unsupported).error.code).toBe("unsupported_attachment_type");
    expect(json(unsupported).error.details.allowedExtensions).toContain(".pdf");

    const html = await upload(
      api,
      cookie,
      "website",
      "page.html",
      Buffer.from("<html></html>"),
    );
    expect(html.statusCode).toBe(415);

    const mismatched = await upload(
      api,
      cookie,
      "website",
      "not-a-pdf.pdf",
      Buffer.from("plain text"),
    );
    expect(mismatched.statusCode).toBe(415);
    expect(json(mismatched).error.message).toContain("PDF");

    const invalid = await upload(
      api,
      cookie,
      "website",
      "report.pdf",
      PDF,
      "not base64!!",
    );
    expect(invalid.statusCode).toBe(422);
    expect(json(invalid).error.code).toBe("validation_failed");

    const empty = await upload(api, cookie, "website", "report.pdf", PDF, "");
    expect(empty.statusCode).toBe(422);

    const tooLarge = await upload(
      api,
      cookie,
      "website",
      "large.pdf",
      Buffer.alloc(MAX_ATTACHMENT_BYTES + 1, 0x25),
    );
    expect(tooLarge.statusCode).toBe(413);
    expect(json(tooLarge).error.code).toBe("attachment_too_large");
  });

  it("enforces 20 attachments per project", async () => {
    api = await createTestApi();
    const cookie = await superCookie(api);

    for (let index = 1; index <= 20; index += 1) {
      const response = await upload(
        api,
        cookie,
        "website",
        `image-${index}.png`,
        PNG,
      );
      expect(response.statusCode).toBe(201);
    }
    const overLimit = await upload(api, cookie, "website", "image-21.png", PNG);
    expect(overLimit.statusCode).toBe(409);
    expect(json(overLimit).error.code).toBe("attachment_limit_reached");
    expect(json(overLimit).error.details.maxAttachments).toBe(20);
  });

  it("isolates owners, cascades project deletion and copies attachments on duplicate", async () => {
    api = await createTestApi();
    const cookie = await superCookie(api);
    const member = await api.createMember(cookie, {
      email: "attachments-member@example.test",
    });

    const attachment = json(
      await upload(api, cookie, "website", "../safe.pdf", PDF),
    );
    expect(attachment.filename).toBe("safe.pdf");

    const hidden = await api.app.inject({
      method: "GET",
      url: "/api/v1/projects/website/attachments",
      headers: authHeaders(member.cookie),
    });
    expect(hidden.statusCode).toBe(404);

    const hiddenUpload = await upload(
      api,
      member.cookie,
      "website",
      "intruder.pdf",
      PDF,
    );
    expect(hiddenUpload.statusCode).toBe(404);

    const duplicate = await api.app.inject({
      method: "POST",
      url: "/api/v1/projects/website/duplicate",
      headers: authHeaders(cookie),
    });
    expect(duplicate.statusCode).toBe(201);
    const duplicateId = json(duplicate).id;
    const duplicateList = await api.app.inject({
      method: "GET",
      url: `/api/v1/projects/${duplicateId}/attachments`,
      headers: authHeaders(cookie),
    });
    expect(json(duplicateList).attachments).toHaveLength(1);
    expect(json(duplicateList).attachments[0].filename).toBe("safe.pdf");
    expect(json(duplicateList).attachments[0].id).not.toBe(attachment.id);

    const copiedContent = await api.app.inject({
      method: "GET",
      url: `/api/v1/projects/${duplicateId}/attachments/${json(duplicateList).attachments[0].id}/content`,
      headers: authHeaders(cookie),
    });
    expect(copiedContent.rawPayload.equals(PDF)).toBe(true);

    const removedProject = await api.app.inject({
      method: "DELETE",
      url: `/api/v1/projects/${duplicateId}`,
      headers: {
        ...authHeaders(cookie),
        "if-match": String(duplicate.headers.etag),
      },
    });
    expect(removedProject.statusCode).toBe(200);
    const gone = await api.app.inject({
      method: "GET",
      url: `/api/v1/projects/${duplicateId}/attachments`,
      headers: authHeaders(cookie),
    });
    expect(gone.statusCode).toBe(404);
    const count = api.db
      .prepare("SELECT COUNT(*) AS count FROM attachments WHERE project_id = ?")
      .get(duplicateId) as { count: number };
    expect(count.count).toBe(0);
  });
});
