# Phase 15 — File attachments

Status: in progress  
Updated: 2026-11-17

## Why this phase

A project document currently holds text, criteria, verification rules and commit
references. Supporting material such as a signed PDF, a CSV export, a
screenshot or a spreadsheet has no place in Layers and has to live outside the
workspace.

This phase consumes backlog item **P-21 File attachments**. It adds attachments
to the project document, with the same authorization, storage and limits behind
the UI, the REST API and MCP.

## Goal

The owner of a project can attach up to 20 files of type PDF, CSV, JPEG, PNG or
XLS to the project document, 10 MiB per file, and can list, download and delete
them. The browser and an MCP agent use the same stored data and enforce the same
limits. Attachments survive restart and are removed with their project.

## Locked decisions

| # | Decision | Choice |
| --- | --- | --- |
| 1 | Document scope | Attachments belong to the project document, not to an individual chapter. A project has one attachment set shared by all of its chapters. |
| 2 | Limits | At most 20 attachments per project and at most 10 MiB (10 × 1024 × 1024 bytes) of decoded content per attachment. The limits are shared constants in `src/domain/attachments.ts`. |
| 3 | Accepted types | `.pdf` → `application/pdf`, `.csv` → `text/csv`, `.jpg`/`.jpeg` → `image/jpeg`, `.png` → `image/png`, `.xls` → `application/vnd.ms-excel`. `.xlsx` is not accepted in this phase. |
| 4 | Validation | The extension decides the accepted type. The decoded bytes are also checked against the type's signature; CSV must be valid UTF-8 without NUL bytes. A mismatch returns `415 unsupported_attachment_type`. |
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
- a file input accepting the five extensions, with client-side extension, size
  and count checks before uploading;
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
   signature validation for PDF, PNG, JPEG, XLS and CSV.
2. API tests cover upload, list, metadata, binary download headers and bytes,
   deletion, the 20-file limit, the 10 MiB limit, unsupported types, malformed
   base64, owner isolation, cascade deletion, project duplication and unchanged
   document ETag after upload/delete.
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
- No `.xlsx` or other formats until the allowlist is extended deliberately.
