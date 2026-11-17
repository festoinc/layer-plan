# Phase 15 — File attachments

Status: delivered  
Updated: 2026-11-17

## Delivery and verification

- CI `verify` passed on `main` (run 44181798520): lint, format, typecheck, unit,
  API, contract, build and Playwright. The `docker` job published `latest` and
  `sha-969a741`.
- Tested image: `ghcr.io/festoinc/layer-plan:sha-969a741`, digest
  `sha256:7ccd3909f7b7165aadf8e95be689e0c9befe08b7bfbbbf727e297c90239b2cb1`,
  revision `969a741561c7279eff597fba140098768d8a479d`, runtime user `node`.
- Remote checks ran on the shared test host in an isolated container on
  `127.0.0.1:18082` with a fresh `layers-e2e-attachments-data` volume. The
  existing phase 1a container on `18080` and the shared nginx virtual host were
  left untouched.
- REST checks passed for every accepted format: PDF, CSV/TSV, TXT, MD, LOG,
  JSON, YAML/YML, TOON, PNG, XLSX, DOCX and PPTX. List limits, metadata,
  binary download headers and bytes, activity entries and the unchanged
  document ETag were verified.
- Rejections passed: HTML returned `415 unsupported_attachment_type`, a
  signature mismatch returned `415`, a 10 MiB + 1 byte upload returned
  `413 attachment_too_large`, and the 21st attachment returned
  `409 attachment_limit_reached`.
- Project duplication copied all 20 attachments and their content; deleting the
  duplicate removed its copies.
- MCP checks passed over the loopback port: initialization, the 15-tool list,
  `add_attachment`, `list_attachments`, `get_attachment` with identical base64
  content, and `delete_attachment`. A read-only key received `403` for
  `add_attachment`.
- Persistence passed after both `docker restart` and
  `docker rm -f` plus a fresh container on the same volume: the session cookie,
  all 20 attachments, the downloaded PDF bytes and document ETag `"1"`
  survived. The UI dialog behaviour ran in the CI Playwright suite.
- Cleanup removed the container, volume, environment file, state files and
  temporary Docker config. Port `18082` is free, nginx is active, satia and n8n
  still run, and the existing `layers-e2e-app` container remains up.
- The local gate (`lint`, `format:check`, `typecheck`, `api:lint`, `build`)
  passed before every push.

## Why this phase

A project document currently holds text, criteria, verification rules and commit
references. Supporting material such as a signed PDF, a CSV export, a
screenshot or a spreadsheet has no place in Layers and has to live outside the
workspace.

This phase consumes backlog item **P-21 File attachments**. It adds attachments
to the project document, with the same authorization, storage and limits behind
the UI, the REST API and MCP.

## Goal

The owner of a project can attach up to 20 files of the supported document,
image, spreadsheet and text/data formats to the project document, 10 MiB per
file, and can list, download and delete them. The browser and an MCP agent use the same stored data and enforce the same
limits. Attachments survive restart and are removed with their project.

## Locked decisions

| # | Decision | Choice |
| --- | --- | --- |
| 1 | Document scope | Attachments belong to the project document, not to an individual chapter. A project has one attachment set shared by all of its chapters. |
| 2 | Limits | At most 20 attachments per project and at most 10 MiB (10 × 1024 × 1024 bytes) of decoded content per attachment. The limits are shared constants in `src/domain/attachments.ts`. |
| 3 | Accepted types | `.pdf` → `application/pdf`, `.csv` → `text/csv`, `.tsv` → `text/tab-separated-values`, `.txt`/`.log` → `text/plain`, `.md` → `text/markdown`, `.json` → `application/json`, `.yaml`/`.yml` → `application/yaml`, `.toon` → `text/toon`, `.jpg`/`.jpeg` → `image/jpeg`, `.png` → `image/png`, `.xls` → `application/vnd.ms-excel`, `.xlsx` → `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`, `.docx` → `application/vnd.openxmlformats-officedocument.wordprocessingml.document`, `.pptx` → `application/vnd.openxmlformats-officedocument.presentationml.presentation`. |
| 4 | Validation | The extension decides the accepted type. PDF, JPEG, PNG and OLE files are checked against their signatures. Text, CSV, TSV, Markdown, log, JSON, YAML and TOON must be valid UTF-8 without NUL bytes. XLSX, DOCX and PPTX must be ZIP packages containing their expected part. A mismatch returns `415 unsupported_attachment_type`. |
| 5 | Storage | A new `attachments` table stores metadata and the content as a SQLite `BLOB`, with a foreign key to `projects` and `ON DELETE CASCADE`. No file system directory and no object storage. |
| 6 | Revision semantics | Attachments are a separate collection. Uploading or deleting one does not change the document or metadata revision and does not create optimistic-concurrency conflicts for editors. Attachment changes are recorded in project activity. |
| 7 | REST upload | JSON `{ filename, contentBase64 }` to `POST /projects/{projectId}/attachments`. No multipart dependency. The route has a dedicated 14 MiB body limit; decoded content is enforced at 10 MiB. |
| 8 | REST download | Binary `GET /projects/{projectId}/attachments/{attachmentId}/content` with `Content-Type`, `Content-Length`, `Content-Disposition: attachment`, `X-Content-Type-Options: nosniff` and `Cache-Control: no-store`. Metadata is available from the collection and the item endpoint. |
| 9 | MCP | Four operations: `list_attachments`, `get_attachment` (metadata plus base64), `add_attachment` and `delete_attachment`. `get_attachment` reads the store in-process because the REST content route is binary. Mutations require the write scope. |
| 10 | MCP size limit | The MCP request and response limit increases from 2 MiB to 15 MiB so a 10 MiB attachment fits after base64 encoding. The generic envelope still rejects responses above that limit; `get_attachment` is bounded by the attachment limit. |
| 11 | UI | An **Attachments** dialog opened from the sidebar and the chapter header. It lists files, uploads one or more selected files, downloads through an authenticated blob request and deletes with an inline confirmation. |
| 12 | Duplication | Duplicating a project copies its attachments with new ids. Project deletion cascades. Export/import remains document-only; attachments are not embedded in the JSON export. |
| 13 | Activity | Upload and delete append an activity entry such as `Attached report.pdf` or `Removed report.pdf`, attributed to the current user. |

## 1. Domain model

`src/domain/attachments.ts` is shared by the server and the browser:

- `MAX_ATTACHMENTS = 20`;
- `MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024`;
- the extension/type table and `ATTACHMENT_ACCEPT`;
- `AttachmentInfo` (`id`, `projectId`, `filename`, `contentType`, `sizeBytes`,
  `sha256`, `createdAt`, `createdByName`);
- filename normalization and content validation helpers.

Filename handling takes the basename, removes path separators and control
characters, trims whitespace, and rejects an empty name or a name longer than
255 characters. The extension is matched case-insensitively; the stored name
keeps the user's case.

## 2. Database

Migration `005_attachments.sql`:

```sql
CREATE TABLE attachments (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  filename TEXT NOT NULL,
  content_type TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  sha256 TEXT NOT NULL,
  content BLOB NOT NULL,
  created_at TEXT NOT NULL,
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL
) STRICT;
```

An index on `(project_id, created_at DESC)` supports the ordered list.
`sha256` is the lowercase hex digest of the decoded content. The store exposes
`listAttachments`, `getAttachment`, `addAttachment` and `deleteAttachment`; all
of them require the project owner and return `404` for another user's project.

## 3. REST contract

| Method | Path | Result |
| --- | --- | --- |
| `GET` | `/api/v1/projects/{projectId}/attachments` | `{ attachments, maxAttachments, maxAttachmentBytes, allowedExtensions }` |
| `POST` | `/api/v1/projects/{projectId}/attachments` | `201 AttachmentInfo` + `Location` |
| `GET` | `/api/v1/projects/{projectId}/attachments/{attachmentId}` | `AttachmentInfo` |
| `GET` | `/api/v1/projects/{projectId}/attachments/{attachmentId}/content` | binary content |
| `DELETE` | `/api/v1/projects/{projectId}/attachments/{attachmentId}` | `204` |

Upload errors:

- `413 attachment_too_large` when decoded content exceeds 10 MiB;
- `409 attachment_limit_reached` when the project already has 20;
- `415 unsupported_attachment_type` for an unsupported extension, a type
  mismatch or invalid CSV text;
- `422 validation_failed` for a malformed body, filename or base64 payload.

The list is newest first. Downloads use the stored filename in
`Content-Disposition` and never inline the content.

## 4. MCP tools

| Tool | Arguments | Notes |
| --- | --- | --- |
| `list_attachments` | `projectId` | Read-only. |
| `get_attachment` | `projectId`, `attachmentId` | Read-only. Returns metadata plus `contentBase64`. |
| `add_attachment` | `projectId`, `filename`, `contentBase64` | Mutating; requires write scope. |
| `delete_attachment` | `projectId`, `attachmentId` | Destructive; ask for confirmation. |

The first, third and fourth tools proxy the REST routes through the existing
in-process dispatch. `get_attachment` reads the store directly and returns the
standard `{ status, body, etag }` envelope with `etag: null`. Tool arguments are
bound to the credential's project; another project id returns `not_found`.

## 5. UI

`AttachmentsDialog` is a modal with:

- the project name and current count against the limit;
- a file input accepting the allowed extensions, with client-side extension,
  size and count checks before uploading;
- one row per attachment with filename, type, formatted size, upload time,
  download and a two-step delete;
- loading, empty, error and notice states.

The dialog is reachable from **Attachments** in the sidebar tools and a paperclip
button in the chapter document header. Uploads convert the selected file to
base64 in the browser and use the JSON API. Downloads fetch the binary endpoint
with the session cookie and save it through a temporary object URL, so the
development UI on port 5173 works with the API on port 3001.

## 6. Tests and acceptance criteria

1. Unit tests cover the extension table, filename normalization, size limit and
   validation for PDF, PNG, JPEG, XLS, XLSX, DOCX, PPTX and text/data formats.
2. API tests cover upload, list, metadata, binary download headers and bytes,
   deletion, every accepted format, the 20-file limit, the 10 MiB limit,
   unsupported types, malformed base64, owner isolation, cascade deletion,
   project duplication and unchanged document ETag after upload/delete.
3. MCP tests assert the four new tools, read-only scope rejection, add/list/get/
   delete round-trip, base64 content equality, wrong-project rejection and the
   destructive annotation.
4. OpenAPI tests include the three new paths, validate upload/list/item
   responses and keep the 401/403 requirements.
5. Playwright covers uploading a PDF, seeing it after reload, validating an
   unsupported type and deleting it.
6. Static checks: `lint`, `format:check`, `typecheck`, `api:lint`, `build`.
7. CI is the only local runtime gate; remote persistence and download checks are
   run on the exact published image.

## 7. Boundaries

- No chapter-level attachments, no inline preview, no image thumbnails and no
  full-text search inside attachments.
- No attachment metadata in the project export or import.
- No virus scanning, per-file sharing, public links or per-attachment
  permissions.
- No HTML, SVG, executable files or archives. Adding another format requires an
  explicit allowlist entry, validation rule, contract update and tests.
