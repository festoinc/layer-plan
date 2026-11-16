-- Project-scoped API keys replace account-wide test tokens.
--
-- The previous api_tokens rows were created only for phase 9 testing. Rebuild
-- the table so project_id is required and deleting a project removes its keys.
CREATE TABLE api_tokens_project_keys (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  prefix TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  scopes TEXT NOT NULL,
  created_at TEXT NOT NULL,
  last_used_at TEXT,
  expires_at TEXT,
  revoked_at TEXT
) STRICT;

DROP TABLE api_tokens;

ALTER TABLE api_tokens_project_keys RENAME TO api_tokens;

CREATE INDEX idx_api_tokens_user ON api_tokens(user_id);
CREATE INDEX idx_api_tokens_project ON api_tokens(project_id);
