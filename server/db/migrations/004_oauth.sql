CREATE TABLE oauth_clients (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  redirect_uris TEXT NOT NULL,
  grant_types TEXT NOT NULL,
  response_types TEXT NOT NULL,
  token_endpoint_auth_method TEXT NOT NULL
    CHECK (token_endpoint_auth_method IN (
      'none', 'client_secret_post', 'client_secret_basic'
    )),
  client_secret_hash TEXT,
  source TEXT NOT NULL CHECK (source IN ('dcr')),
  created_at TEXT NOT NULL,
  last_used_at TEXT
) STRICT;

CREATE INDEX idx_oauth_clients_created ON oauth_clients(created_at);

CREATE TABLE oauth_authorization_requests (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL REFERENCES oauth_clients(id) ON DELETE CASCADE,
  redirect_uri TEXT NOT NULL,
  scopes TEXT NOT NULL,
  state TEXT,
  code_challenge TEXT NOT NULL,
  code_challenge_method TEXT NOT NULL CHECK (code_challenge_method = 'S256'),
  resource TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'denied')),
  user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
  decided_at TEXT
) STRICT;

CREATE INDEX idx_oauth_requests_expires ON oauth_authorization_requests(expires_at);
CREATE INDEX idx_oauth_requests_client ON oauth_authorization_requests(client_id);

CREATE TABLE oauth_authorization_codes (
  code_hash TEXT PRIMARY KEY,
  client_id TEXT NOT NULL REFERENCES oauth_clients(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  scopes TEXT NOT NULL,
  redirect_uri TEXT NOT NULL,
  code_challenge TEXT NOT NULL,
  resource TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  consumed_at TEXT
) STRICT;

CREATE INDEX idx_oauth_codes_expires ON oauth_authorization_codes(expires_at);
CREATE INDEX idx_oauth_codes_client ON oauth_authorization_codes(client_id);

CREATE TABLE oauth_grants (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL REFERENCES oauth_clients(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  scopes TEXT NOT NULL,
  resource TEXT NOT NULL,
  access_token_hash TEXT NOT NULL UNIQUE,
  refresh_token_hash TEXT NOT NULL UNIQUE,
  previous_refresh_token_hash TEXT UNIQUE,
  access_expires_at TEXT NOT NULL,
  refresh_expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  last_used_at TEXT,
  revoked_at TEXT
) STRICT;

CREATE INDEX idx_oauth_grants_user_project
  ON oauth_grants(user_id, project_id, created_at DESC);
CREATE INDEX idx_oauth_grants_access ON oauth_grants(access_token_hash);
CREATE INDEX idx_oauth_grants_refresh ON oauth_grants(refresh_token_hash);
CREATE INDEX idx_oauth_grants_previous_refresh
  ON oauth_grants(previous_refresh_token_hash);
