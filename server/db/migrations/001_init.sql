CREATE TABLE projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  initials TEXT NOT NULL,
  color TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  test_guidelines TEXT NOT NULL DEFAULT '',
  chapter_count INTEGER NOT NULL DEFAULT 0,
  criterion_count INTEGER NOT NULL DEFAULT 0,
  checked_count INTEGER NOT NULL DEFAULT 0,
  metadata_revision INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
) STRICT;

CREATE TABLE project_documents (
  project_id TEXT PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
  revision INTEGER NOT NULL DEFAULT 1,
  chapters_json TEXT NOT NULL,
  selected_id TEXT,
  updated_at TEXT NOT NULL
) STRICT;

CREATE TABLE activity_entries (
  sequence INTEGER PRIMARY KEY AUTOINCREMENT,
  id TEXT NOT NULL,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  message TEXT NOT NULL,
  chapter_id TEXT,
  chapter_name TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (project_id, id)
) STRICT;

CREATE INDEX idx_activity_project_sequence
  ON activity_entries(project_id, sequence DESC);

CREATE TABLE app_state (
  key TEXT PRIMARY KEY,
  value TEXT
) STRICT;
