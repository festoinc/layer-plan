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

CREATE INDEX idx_attachments_project_created
  ON attachments(project_id, created_at DESC, id);
