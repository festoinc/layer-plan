# AGENTS.md

Instructions for coding agents working in this repository. Read this before
planning or changing code.

`LAYERS_AGENT_GUIDE.md` is a product artifact for people and agents using the
Layers MCP endpoint. It is not repository guidance.

## Reading order

1. This file.
2. `phases/phase-ideas.md` for the backlog.
3. The phase document for the work in `phases/`. Follow its locked decisions.
4. `README.md`, `docs/api.md` and `server/api/openapi.yaml` as needed.

## Project facts

- Layers is a Vite + React 19 UI and a Fastify 5 API backed by SQLite.
- Node 22 or newer is required.
- The API and built UI run from one process on port `3001`.
- Native runtime dependencies: `better-sqlite3` and `@node-rs/argon2`.
- The API is the source of truth; there is no browser persistence.
- Every project is private to its owner. Auth is required outside test mode.
- Default local database: `data/layers.sqlite` (gitignored).
- Default bind: `127.0.0.1:3001`; a non-loopback bind requires
  `LAYERS_ALLOW_REMOTE=1`.
- Read `server/config.ts` before adding environment variables.

Useful local commands:

```sh
npm run lint
npm run format:check
npm run typecheck
npm run build
npm run api:lint
```

## Testing policy

There is no local runtime test environment.

- Do **not** run Docker, Compose, the built app, Playwright, API integration
  tests or database persistence tests on the developer machine.
- Local commands are limited to static and build checks: `lint`,
  `format:check`, `typecheck`, `api:lint` and `build`.
- CI is the only test gate. Push a branch/PR and wait for the `verify` job.
- Only a push to `main` after `verify` builds and publishes the Docker image.
- Docker, Compose, persistence, backup/restore and deployment checks run on the
  shared remote test host.
- Never report something as tested because it builds locally or because a local
  smoke check passed.

Work on a branch/PR while iterating. Every push to `main` publishes a new image
and deletes the previous image version, so merge when the change is ready.

CI commands:

```sh
gh run list --branch main --limit 3
gh run watch <run-id> --exit-status
gh run view <run-id> --log
```

The Docker job is gated by `needs: verify`, so a failing test suite never
publishes. On `main` it builds `linux/amd64`, smoke-tests the container, pushes
`latest` and `sha-<7>`, verifies both tags share one digest, and prunes older
package versions.

## Remote test host

The host is provided out-of-band by the human. If `.agents.local.md` exists in
the repository root, read it for host-specific access notes.

Never commit the host address, SSH keys, passwords, `.env` files or registry
credentials: this repository is public.

The host is shared infrastructure. Expect host nginx on `:80`/`:443`, satia on
`:8443`, n8n on `:5678`, and Postgres on `:5432`/`:5433`.

Rules:

- Do not modify nginx, Cloudflare, firewall rules or other Compose projects.
- Do not restart nginx or the Docker daemon.
- Do not run `docker system prune`, `docker volume prune` or remove images or
  volumes you did not create.
- Publish test ports on `127.0.0.1` only; never `0.0.0.0`.
- Use unique container, network and volume names. Prefix test resources with
  `layers-e2e` or `layers-final`.
- Generate a temporary super-admin password, keep it in a `chmod 600` env file,
  and delete it during cleanup. Do not print it.
- Always clean up containers, volumes, test directories and temp Docker config.
- Before and after testing, check that nginx and the other services are still
  running.

### Layers MCP nginx host

The host has a dedicated nginx virtual host for the Layers MCP test domain;
the domain and host address are in `.agents.local.md`. It was configured with
the user's explicit authorization. The existing restriction on changing nginx
still applies to future work unless the user explicitly authorizes it.

- The enabled configuration is `/etc/nginx/sites-enabled/layers-e2e-phase9`,
  linked to `/etc/nginx/sites-available/layers-e2e-phase9`. It does not change
  the existing satia or n8n virtual hosts.
- Port 80 serves ACME challenges from `/var/www/layers-mcp-acme` and redirects
  other requests to HTTPS. Port 443 uses the domain's Certbot-managed Let's
  Encrypt certificate under `/etc/letsencrypt/live/<domain>/`; the Certbot
  renewal configuration uses the same ACME webroot.
- HTTPS requests proxy to `127.0.0.1:18080`, preserve the original Host header,
  disable proxy buffering, and use a 300-second proxy read timeout. nginx limits
  request bodies to 2 MiB for the entire virtual host, including the UI and
  REST API as well as MCP.
- The isolated phase 9 test container and its volume were removed after the
  tests. No Layers backend was listening on `127.0.0.1:18080` at that point,
  so the HTTPS endpoint returned 502 despite having a valid certificate.
  A later test must provide its own isolated loopback backend and clean it up.
- For MCP access, set `LAYERS_MCP_ALLOWED_HOSTS` to include the test domain.
  Use HTTPS for project API keys and do not publish the backend port publicly.
  The default Compose port binding needs a loopback-only test override.

The 2026-11-16 remote HTTPS test verified MCP reads, document writes, stale
revision handling, user isolation and read-only scopes. Codex CLI 0.169.0
connected, but its session's `never` approval policy blocked write tool calls;
it attempted a requested deletion without first asking in chat. The confirmation
and Codex write acceptance checks remain open as backlog item P-20.

Access pattern:

```sh
export LAYERS_TEST_HOST=<provided by the human>
ssh root@"$LAYERS_TEST_HOST" 'hostname; . /etc/os-release; echo "$PRETTY_NAME"'
```

## Remote verification recipe

The commands below are the pattern used to verify phase 8. Replace
`$LAYERS_TEST_HOST`; keep paths and names prefixed so the test cannot collide
with production services.

### 1. Recon

```sh
ssh root@"$LAYERS_TEST_HOST" 'set -e
  hostname; . /etc/os-release; echo "$PRETTY_NAME"; uname -r
  docker --version; docker compose version
  docker ps --format "table {{.Names}}\t{{.Image}}\t{{.Ports}}"
  ss -ltnp | sed -n "1,40p"
  df -h /; free -m
  ss -ltn | grep -q ":18080 " && echo BUSY || echo FREE
  systemctl is-active nginx'
```

Choose a free loopback port; `18080` worked for phase 8 and `18081` for the
restore check.

### 2. Isolated checkout and config

```sh
ssh root@"$LAYERS_TEST_HOST" 'set -e
  rm -rf /root/layers-e2e
  git clone --depth 1 https://github.com/festoinc/layer-plan.git /root/layers-e2e
  cd /root/layers-e2e
  PASSWORD=$(openssl rand -hex 16)
  printf "LAYERS_SUPER_ADMIN_EMAIL=admin@layers-e2e.test\nLAYERS_SUPER_ADMIN_PASSWORD=%s\nLAYERS_SUPER_ADMIN_NAME=E2E Admin\n" "$PASSWORD" > .env
  chmod 600 .env
  cat > docker-compose.override.yml <<"YAML"
services:
  app:
    ports: !override
      - "127.0.0.1:18080:3001"
YAML
  docker compose -p layers-e2e config --format json |
    python3 -c "import json,sys; d=json.load(sys.stdin); print(d[\"services\"][\"app\"][\"ports\"])"'
```

Compose 2.26 supports `!override` for replacing the published ports list. The
base file exposes `${LAYERS_HTTP_PORT:-80}:3001`; do not use host port 80 here.

### 3. Anonymous public pull

Verify the public package without touching host registry credentials:

```sh
ssh root@"$LAYERS_TEST_HOST" 'set -e
  rm -rf /tmp/layers-anon && mkdir -p /tmp/layers-anon
  DOCKER_CONFIG=/tmp/layers-anon docker pull ghcr.io/festoinc/layer-plan:latest
  DOCKER_CONFIG=/tmp/layers-anon docker image inspect ghcr.io/festoinc/layer-plan:latest \
    --format "revision={{index .Config.Labels \"org.opencontainers.image.revision\"}} user={{.Config.User}}"'
```

Expected: pull succeeds without login, `user=node`, revision matches the pushed
commit.

### 4. Start and surface checks

```sh
ssh root@"$LAYERS_TEST_HOST" 'set -e
  cd /root/layers-e2e
  export DOCKER_CONFIG=/tmp/layers-anon
  docker compose -p layers-e2e up -d
  for i in $(seq 1 60); do
    curl -fsS http://127.0.0.1:18080/api/v1/health 2>/dev/null &&
      break
    sleep 2
  done
  curl -fsS http://127.0.0.1:18080/api/v1/health
  test "$(curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:18080/)" = 200
  test "$(curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:18080/api/v1/openapi.json)" = 200
  test "$(curl -sL -o /dev/null -w "%{http_code}" http://127.0.0.1:18080/api/v1/docs)" = 200
  test "$(curl -s -o /dev/null -w "%{http_code}" -X POST http://127.0.0.1:18080/api/v1/test/reset)" = 404
  docker inspect layers --format "health={{.State.Health.Status}} user={{.Config.User}}"'
```

Observed phase 8 result:

```text
health: {"status":"ok","version":"1.0.0","database":"ok"}
root: 200 text/html; charset=utf-8
openapi: 200 application/json; charset=utf-8
docs-follow: 200
test-reset: 404
user=node
```

The Docker `HEALTHCHECK` reports `starting` for up to about 50 seconds
(`start-period` 20 s + `interval` 30 s). Poll HTTP health first, then check
`docker inspect`.

### 5. API and persistence

Sign in, create a project, write a document with commits, and verify the
surrounding surfaces:

```sh
BASE=http://127.0.0.1:18080/api/v1
COOKIES=/tmp/layers-e2e-cookies.txt
EMAIL=$(sed -n 's/^LAYERS_SUPER_ADMIN_EMAIL=//p' /root/layers-e2e/.env)
PASSWORD=$(sed -n 's/^LAYERS_SUPER_ADMIN_PASSWORD=//p' /root/layers-e2e/.env)
LOGIN=$(EMAIL="$EMAIL" PASSWORD="$PASSWORD" python3 -c \
  'import json,os; print(json.dumps({"email":os.environ["EMAIL"],"password":os.environ["PASSWORD"]}))')
curl -fsS -c "$COOKIES" -X POST "$BASE/auth/login" \
  -H 'Content-Type: application/json' --data "$LOGIN" -o /dev/null
curl -fsS -b "$COOKIES" -X POST "$BASE/projects" \
  -H 'Content-Type: application/json' -d '{"name":"E2E Docker persistence"}'
```

Then use the document flow from `docs/api.md`:

- `GET /projects/<id>/document` to read the `ETag`.
- `PUT /projects/<id>/document` with `If-Match` and a chapter whose `commits`
  contains an uppercase hash such as `E15D2C7`.
- Confirm the response stores `e15d2c7`, increments `revision`, and returns
  correct `stats`.
- Repeat the PUT with the old revision and expect
  `412 revision_conflict`.
- `GET /coverage` and confirm the eligible subchapter row carries `commits`.
- `GET /activity` and confirm `actorName`; the response shape is
  `{ "events": [...], "nextBefore": null }`.
- `GET /export` and confirm the chapter and commit hash are present.

Persistence:

```sh
docker compose -p layers-e2e restart app
# wait for health, then re-read the document; the session cookie and data must survive

docker compose -p layers-e2e up -d --force-recreate
# wait for health, then re-read the document again
```

Observed phase 8 result:

```text
put: revision 2, chapters 1, criteria 1, checked 1, commits ['e15d2c7']
stale: 412 revision_conflict
coverage: total 1, automated 1, percent 100, commits ['e15d2c7']
activity: E2E subchapter saved / E2E subchapter / E2E Admin
after-restart: E2E subchapter ['e15d2c7'] True revision 3
after-recreate: E2E subchapter ['e15d2c7'] revision 3
graceful-shutdown: yes (SIGTERM)
```

### 6. Backup and restore

Back up with the app stopped so SQLite checkpoints the WAL:

```sh
cd /root/layers-e2e
docker compose -p layers-e2e stop app
docker run --rm --user 0 \
  -v layers-data:/data:ro -v /root/layers-e2e:/backup \
  --entrypoint tar ghcr.io/festoinc/layer-plan:latest \
  czf /backup/layers-data.tar.gz -C /data .
docker compose -p layers-e2e start app
```

After a clean stop the archive may contain only `layers.sqlite`; that is
expected because the WAL is checkpointed and removed on close.

Restore into a scratch volume, fix ownership, and start a second container:

```sh
docker volume create layers-e2e-restore
docker run --rm --user 0 \
  -v layers-e2e-restore:/data -v /root/layers-e2e:/backup \
  --entrypoint sh ghcr.io/festoinc/layer-plan:latest \
  -c 'tar xzf /backup/layers-data.tar.gz -C /data && chown -R 1000:1000 /data'
docker run -d --name layers-e2e-restore -p 127.0.0.1:18081:3001 \
  --env-file /root/layers-e2e/.env -v layers-e2e-restore:/app/data \
  ghcr.io/festoinc/layer-plan:latest
# wait for http://127.0.0.1:18081/api/v1/health, sign in, read the document
```

The restored app must return the same chapter, commit list and checked
criteria. Clean up the restore container and volume afterward.

### 7. Cleanup and host check

```sh
cd /root/layers-e2e
docker compose -p layers-e2e down -v
docker rm -f layers-e2e-restore 2>/dev/null || true
docker volume rm layers-e2e-restore 2>/dev/null || true
rm -rf /root/layers-e2e /tmp/layers-anon /tmp/layers-e2e-cookies.txt

docker ps -a --filter name=layers --format '{{.Names}}'
docker volume ls --filter name=layers --format '{{.Name}}'
ss -ltn | grep -E ':18080 |:18081 ' || echo "test ports free"
systemctl is-active nginx
docker ps --format '{{.Names}}'
```

Expected: no `layers` containers or volumes, test ports free, nginx active, and
satia/n8n still running. Remove an untagged image you created:

```sh
docker image ls ghcr.io/festoinc/layer-plan --format '{{.Tag}} {{.ID}} {{.Size}}'
docker image rm <untagged-id>   # only if you created it
```

## Docker and phase 8 invariants

- Image: `ghcr.io/festoinc/layer-plan`, public, anonymous pull.
- Tags: `latest` and `sha-<7>`; only the newest package version is kept.
- Platforms: `linux/amd64` only.
- Base: `node:22-bookworm-slim`; build tools exist only in the builder stage.
- Runtime: non-root `node`, port `3001`, database `/app/data/layers.sqlite`.
- Image defaults: `HOST=0.0.0.0`, `LAYERS_ALLOW_REMOTE=1`,
  `LAYERS_DB_PATH=/app/data/layers.sqlite`, `LAYERS_SEED_SAMPLES=0`.
- Super-admin credentials come from runtime env; `.env` is never in the image.
- Provenance and SBOM attestations are disabled (`provenance: false`,
  `sbom: false`). GHCR otherwise creates a manifest index, and retention can
  delete the child image manifest while keeping the index, breaking `latest`.
- The workflow fails before pruning if the pushed artefact is an index. Do not
  re-enable attestations without replacing the retention step.
- No nginx, TLS, reverse proxy, automated deployment or ARM image is part of
  phase 8.
- `docker-compose.yml` is the production file; test overrides belong in the
  temporary checkout, never in the committed file.

## Gotchas found during phase 8

- Root chapters are excluded from coverage; create a subchapter to get a
  coverage row.
- `/api/v1/activity` returns `{ events, nextBefore }`, not a bare array.
- `/api/v1/docs` redirects; use `curl -L` and expect a final `200`.
- The host has `python3` but no `jq`; parse JSON with Python.
- The image has `node` but no `curl`, `sqlite3` or compiler. Use the app, or
  `node -e` inside the image, for data checks.
- Native modules require the builder toolchain and the same `bookworm-slim`
  base in the runtime stage.
- Volume files are owned by uid/gid `1000`; restored volumes need
  `chown -R 1000:1000`.
- `docker compose down -v` is required to remove the test volume; plain `down`
  keeps it.
- The server is shared. Never use broad prune commands or edit nginx configs.

## Phase delivery

When the work is complete:

- Update the phase document status to `delivered`.
- Rename the file with the `[done]` suffix, matching earlier phases.
- Remove the delivered idea from `phases/phase-ideas.md`.
- Update `README.md`, `docs/api.md` and `LAYERS_AGENT_GUIDE.md` when the API or
  runtime contract changes.
- Push to `main`, watch `verify` and `docker`, and run the relevant remote
  checks on the exact published digest.
- Record the tested image tags/digest and the cleanup result in the handoff.

## Local-only notes

If `.agents.local.md` exists, it holds host-specific access details and is
gitignored. Never copy its contents into a tracked file, commit message, issue
or screenshot.
