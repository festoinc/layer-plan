CREATE TABLE users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  display_name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('super_admin', 'member')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  disabled_at TEXT
) STRICT;

CREATE UNIQUE INDEX idx_users_email ON users(email COLLATE NOCASE);
CREATE UNIQUE INDEX idx_users_single_super_admin
  ON users(role) WHERE role = 'super_admin';

CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  user_agent TEXT
) STRICT;

CREATE INDEX idx_sessions_user ON sessions(user_id);
CREATE INDEX idx_sessions_expires ON sessions(expires_at);

CREATE TABLE api_tokens (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  prefix TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  scopes TEXT NOT NULL,
  created_at TEXT NOT NULL,
  last_used_at TEXT,
  expires_at TEXT,
  revoked_at TEXT
) STRICT;

CREATE INDEX idx_api_tokens_user ON api_tokens(user_id);

CREATE TABLE user_state (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  active_project_id TEXT REFERENCES projects(id) ON DELETE SET NULL
) STRICT;

ALTER TABLE projects
  ADD COLUMN owner_id TEXT REFERENCES users(id) ON DELETE RESTRICT;
CREATE INDEX idx_projects_owner
  ON projects(owner_id, updated_at DESC);

ALTER TABLE activity_entries
  ADD COLUMN actor_user_id TEXT REFERENCES users(id) ON DELETE SET NULL;
CREATE INDEX idx_activity_actor ON activity_entries(actor_user_id);
