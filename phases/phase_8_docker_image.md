# Phase 8 — Docker image built and published on every push to main

Status: planned  
Date: 2026-11-16

## Goal

Package the already-built application as a production Docker image, publish it
publicly to GitHub Container Registry, and keep only the newest published image
available.

Phase 8 delivers:

- one multi-stage `Dockerfile` that builds the UI and server bundle and runs them
  as a non-root user;
- a single-container runtime: Fastify serves the API and the built UI on
  `:3001`; no nginx and no other process;
- a `.dockerignore` that keeps secrets, data, tests and build output out of the
  image and build context;
- a `docker-compose.yml` for the remote server, with a named volume for SQLite;
- a `docker` CI job that runs only after the existing `verify` job is green on a
  push to `main`, builds `linux/amd64`, runs a container smoke test, pushes to
  GHCR, and prunes older image versions;
- a documented public image (`ghcr.io/festoinc/layer-plan`) with `latest` and
  `sha-<short>` tags;
- documentation for pulling, running, configuring, backing up and upgrading the
  container.

Phase 8 does not add a reverse proxy, TLS, automated deployment to the server,
ARM images, Docker Hub publishing or application behaviour changes.

## Locked decisions

| Topic | Decision |
| --- | --- |
| Trigger | Every push to `main`; the image is built from the pushed tip commit |
| Branch name | `main` (the repository's actual default branch; "master" is not used) |
| Gating | The image is built only after the existing `verify` job passes |
| Pull requests | Build and test only; never push an image from a PR |
| Registry | GHCR (`ghcr.io/festoinc/layer-plan`) using the ephemeral `GITHUB_TOKEN` |
| Package visibility | Public |
| Tags | `latest` and `sha-<7 characters>` |
| Retention | Only the newest package version is kept; older versions are deleted automatically |
| Platforms | `linux/amd64` only |
| Base image | `node:22-bookworm-slim` (glibc, matching prebuilt native modules) |
| Build | Multi-stage: install and build in a builder, copy artefacts into a clean runtime stage |
| Runtime user | Non-root `node` user (uid/gid 1000) |
| Process model | One Node process (`node dist-server/index.js`); no nginx, no process manager |
| Container port | `3001`, published by Compose as `${LAYERS_HTTP_PORT:-80}:3001` |
| Data | SQLite at `/app/data/layers.sqlite`, backed by a named volume `layers-data` |
| Sample data | Off in the image (`LAYERS_SEED_SAMPLES=0`); a fresh install starts empty |
| TLS | Out of scope; no `Secure` cookie unless `LAYERS_SECURE_COOKIES=1` is set later |
| Deployment | Build and push only; pulling and restarting on the remote server is manual |
| Smoke test | Runs on the GitHub Actions runner against the built image, not locally |
| Secrets in image | None; `.env` is excluded and all configuration comes from runtime env vars |
| Quality gate | Existing gate unchanged; Docker adds build, smoke and publish checks |
| Local testing | Not required; the CI runner builds and tests the image |

### Derived choices to review

These follow from the answers above but were not stated explicitly. Change them
before implementation if they are wrong.

- **"After every commit" means after every push to `main`.** GitHub Actions
  triggers per push, so five commits pushed together produce one image for the
  tip commit, not five images. Intermediate commits are intentionally skipped.
- **The Docker job lives in the existing `.github/workflows/ci.yml`.** It uses
  `needs: verify`, so a failing test suite cannot publish an image. A separate
  workflow would need a fragile `workflow_run` dependency.
- **Two tags are pushed in one registry operation.** `latest` and
  `sha-<short>` point at the same manifest digest. The cleanup step verifies the
  digests before deleting older versions.
- **Tags are not semver.** The repo has no release/tag workflow; the commit SHA
  is the reliable identifier. A `v*` scheme can be added later.
- **`latest` moves on every main push.** The remote server should run
  `docker compose pull` before `up -d`; Compose is configured with
  `pull_policy: always`.
- **Only one image version is retained.** This intentionally removes rollback by
  digest. The `org.opencontainers.image.revision` label records the commit for
  the image that remains.
- **The builder keeps dev dependencies only while building.** `npm prune
  --omit=dev` runs before the runtime stage copies `node_modules`, so tests,
  ESLint, Prettier, Playwright, Vite, tsup and TypeScript are absent at runtime.
- **UI libraries stay in the runtime `node_modules`.** React, `lucide-react` and
  Markdown packages are declared as production dependencies even though the UI
  is prebuilt. Splitting the dependency lists is not worth the risk in this
  phase; image size is an accepted trade-off.
- **The named volume is the default persistence mechanism.** Docker initializes
  an empty named volume with the ownership of `/app/data` from the image, which
  is `node:node`. A host bind mount would need
  `chown -R 1000:1000 <host-dir>` and is documented as an alternative.
- **The image declares `VOLUME ["/app/data"]`.** Without an explicit mount,
  Docker creates an anonymous volume, so data survives a restart but is harder
  to find. Compose always uses the named volume.
- **No test suite runs inside the image.** Tests run in the `verify` job on the
  runner; the image contains only production artefacts.
- **The container is started with the exec-form CMD.** Node is PID 1 and already
  handles `SIGINT`/`SIGTERM`, so `docker stop` triggers the existing graceful
  shutdown.
- **Compose publishes port 80 by default.** The image itself exposes `3001`
  because the app binds `PORT`; the host mapping is the only place that uses 80.
  Set `LAYERS_HTTP_PORT` if 80 is occupied.
- **The first publish requires one manual visibility change.** GHCR packages
  default to private; after the first successful push, package settings must be
  changed to public. This is a one-time step and is documented.

## 1. Image design

### Stages

`Dockerfile` has two stages:

```dockerfile
# syntax=docker/dockerfile:1

FROM node:22-bookworm-slim AS build
WORKDIR /app
ENV CI=1
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build \
  && npm prune --omit=dev

FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3001 \
    LAYERS_ALLOW_REMOTE=1 \
    LAYERS_DB_PATH=/app/data/layers.sqlite \
    LAYERS_SEED_SAMPLES=0
WORKDIR /app
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
COPY --from=build --chown=node:node /app/dist-server ./dist-server
COPY --from=build --chown=node:node /app/server/api/openapi.yaml ./server/api/openapi.yaml
COPY --from=build --chown=node:node /app/server/db/migrations ./server/db/migrations
COPY --from=build --chown=node:node /app/package.json ./package.json
RUN mkdir -p /app/data && chown node:node /app/data
USER node
EXPOSE 3001
VOLUME ["/app/data"]
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3001/api/v1/health').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"
CMD ["node", "dist-server/index.js"]
```

The toolchain (`python3`, `make`, `g++`) exists only in the builder, as a
fallback for native modules. `better-sqlite3` and `@node-rs/argon2` normally use
prebuilt Linux x64 binaries; the builder still works when a prebuild is missing.
The runtime stage contains no compiler and no package manager cache.

### Why these files are copied

| Path | Reason |
| --- | --- |
| `node_modules` | `tsup` externalizes `better-sqlite3` and `@node-rs/argon2`; both are loaded at runtime |
| `dist` | Built UI; `config.staticRoot` resolves to `<cwd>/dist` |
| `dist-server` | Bundled Fastify entry point |
| `server/api/openapi.yaml` | Read at startup for `/api/v1/openapi.json` and the Scalar docs |
| `server/db/migrations` | `migrate.ts` reads the SQL files at startup; the bundled fallback path is `<cwd>/server/db/migrations` |
| `package.json` | Provides `"type": "module"` for `dist-server/index.js`; without it Node treats the bundle as CommonJS |

`data/`, `dist/` and `dist-server/` from the developer machine are never copied
into the final image. They are rebuilt from source.

### Runtime defaults

The image sets only values that are safe and necessary inside a container:

| Variable | Image value | Notes |
| --- | --- | --- |
| `NODE_ENV` | `production` | No runtime behavioural dependency today; conventional |
| `HOST` | `0.0.0.0` | Loopback is unreachable from outside the container |
| `PORT` | `3001` | Could be overridden, but Compose maps to it |
| `LAYERS_ALLOW_REMOTE` | `1` | Required by `config.ts` for a non-loopback bind |
| `LAYERS_DB_PATH` | `/app/data/layers.sqlite` | Matches the volume mount |
| `LAYERS_SEED_SAMPLES` | `0` | A fresh install starts with no projects |

The image does not set `LAYERS_SUPER_ADMIN_EMAIL`, `LAYERS_SUPER_ADMIN_PASSWORD`,
`LAYERS_TEST_MODE`, `LAYERS_SECURE_COOKIES` or `LAYERS_UI_ORIGIN`. The first two
are required at runtime; the others keep their application defaults (`test mode
off`, plain HTTP cookies, same-origin serving).

### Labels

The image carries OCI labels:

```text
org.opencontainers.image.source   https://github.com/festoinc/layer-plan
org.opencontainers.image.title    Layers
org.opencontainers.image.description  Local project specification workspace
org.opencontainers.image.revision <GITHUB_SHA>
org.opencontainers.image.version  <GITHUB_SHA>
org.opencontainers.image.created  <build timestamp>
```

`VERSION` and `REVISION` are `ARG`s filled by the CI build. `source` links the
package to the repository in the GitHub UI.

### Health and shutdown

- `HEALTHCHECK` calls the existing `GET /api/v1/health` with Node's global
  `fetch`, so no `curl` or `wget` is installed.
- The same endpoint returns `503` when SQLite is unavailable.
- `docker stop` sends `SIGTERM`; `server/index.ts` closes Fastify (and the store)
  before exiting.
- Compose sets `stop_grace_period: 15s` to leave room for shutdown.
- There is no separate liveness endpoint and no metrics endpoint.

## 2. Build context

New `.dockerignore`:

```text
.git
.github
node_modules
dist
dist-server
data
test-results
playwright-report
coverage
phases
docs
tests
.env
.env.*
*.log
.DS_Store
```

Notes:

- `.env` and all `.env.*` variants are excluded; `.env.example` is therefore
  excluded too, which is fine because the image needs no example file.
- `tests/`, `phases/` and `docs/` are excluded from the build context because
  `npm run build` does not read them. CI still runs them from a normal checkout.
- `server/` and `src/` are included; `server/api/openapi.yaml` and
  `server/db/migrations/` must remain in the context.

## 3. Running on the remote server

### Compose file

New `docker-compose.yml`:

```yaml
services:
  app:
    image: ghcr.io/festoinc/layer-plan:latest
    container_name: layers
    restart: unless-stopped
    pull_policy: always
    init: true
    ports:
      - "${LAYERS_HTTP_PORT:-80}:3001"
    env_file: .env
    environment:
      HOST: 0.0.0.0
      PORT: "3001"
      LAYERS_ALLOW_REMOTE: "1"
      LAYERS_DB_PATH: /app/data/layers.sqlite
      LAYERS_SEED_SAMPLES: "0"
    volumes:
      - layers-data:/app/data
    stop_grace_period: 15s

volumes:
  layers-data:
    name: layers-data
```

- `env_file: .env` supplies the super-admin credentials and any optional auth
  settings. The file is created on the server from `.env.example` and is never
  committed.
- The named volume is fixed as `layers-data`, independent of the checkout
  directory name.
- `pull_policy: always` makes `docker compose up -d` fetch the newest published
  image.
- `init: true` reaps orphaned child processes; the app itself spawns none today.
- No nginx, no TLS certificate and no additional service.

### Server runbook

```sh
# one-time
git clone https://github.com/festoinc/layer-plan.git
cd layer-plan
cp .env.example .env
# edit .env: super-admin email/password, optional LAYERS_HTTP_PORT

docker compose pull
docker compose up -d
docker compose ps

# after a new image is published
docker compose pull
docker compose up -d
```

Standalone equivalent without Compose:

```sh
docker pull ghcr.io/festoinc/layer-plan:latest
docker run -d --name layers \
  --restart unless-stopped \
  -p 80:3001 \
  -e LAYERS_SUPER_ADMIN_EMAIL=admin@example.com \
  -e LAYERS_SUPER_ADMIN_PASSWORD='replace-with-at-least-12-characters' \
  -e LAYERS_SUPER_ADMIN_NAME='Super Admin' \
  -v layers-data:/app/data \
  ghcr.io/festoinc/layer-plan:latest
```

### First start and persistence

- The app creates the SQLite file, runs migrations, synchronizes the super
  admin from the environment and creates no sample projects
  (`LAYERS_SEED_SAMPLES=0`).
- Data lives in `volumes/layers-data` managed by Docker, not in the container
  layer or the checkout.
- `docker compose restart`, `docker compose up -d --force-recreate` and image
  upgrades keep the same volume and data.
- Deleting the container keeps the volume; `docker compose down -v` deletes it.
- The super-admin password in `.env` is re-applied at every start; changing it
  and restarting revokes the super admin's existing sessions.
- WAL files (`layers.sqlite-wal`, `layers.sqlite-shm`) live in the same
  directory and must be included in any file-level backup.

### Ports and TLS

- The container listens on `3001`. Compose publishes it on host port 80 by
  default; set `LAYERS_HTTP_PORT=3001` (or another free port) in `.env` to use a
  different host port.
- Publishing port 80 requires no extra capability because Docker performs the
  mapping.
- Without nginx there is no TLS. The session cookie stays non-`Secure` by
  default. Do not expose the container to the public internet until a TLS
  terminator is added in a later phase; use a private network or firewall rule.
- `LAYERS_SECURE_COOKIES=1` is only correct once HTTPS terminates in front of
  the app.

### Backup and restore

The image contains no `sqlite3` binary, so backups are file-level and require a
stopped container for consistency:

```sh
# backup
docker compose stop app
docker run --rm -v layers-data:/data:ro -v "$PWD":/backup \
  alpine tar czf /backup/layers-data.tar.gz -C /data .
docker compose start app

# restore
docker compose stop app
docker run --rm -v layers-data:/data -v "$PWD":/backup \
  alpine sh -c 'rm -rf /data/* && tar xzf /backup/layers-data.tar.gz -C /data'
docker compose start app
```

A host bind mount is supported but must be writable by uid/gid 1000:

```yaml
    volumes:
      - /srv/layers/data:/app/data
```

```sh
sudo mkdir -p /srv/layers/data
sudo chown -R 1000:1000 /srv/layers/data
```

## 4. CI: build, smoke test and publish

The existing `.github/workflows/ci.yml` keeps its `verify` job unchanged and
gains permissions, concurrency and a `docker` job.

### Workflow shape

```yaml
name: CI

on:
  push:
    branches: [main]
  pull_request:

permissions:
  contents: read

jobs:
  verify:
    # unchanged: lint, format, typecheck, unit, api, contract, api lint,
    # generated types, build, Playwright e2e

  docker:
    if: github.event_name == 'push' && github.ref == 'refs/heads/main'
    needs: verify
    runs-on: ubuntu-latest
    concurrency:
      group: docker-main
      cancel-in-progress: false
    permissions:
      contents: read
      packages: write
    steps:
      - uses: actions/checkout@v4
      - uses: docker/setup-buildx-action@v3
      - name: Build image for smoke test
        uses: docker/build-push-action@v6
        with:
          context: .
          load: true
          tags: layers-ci:smoke
          cache-from: type=gha
          cache-to: type=gha,mode=max
          build-args: |
            VERSION=${{ github.sha }}
            REVISION=${{ github.sha }}
      - name: Smoke test
        run: ./scripts/docker-smoke.sh   # inline in the workflow is also fine
      - uses: docker/login-action@v3
        with:
          registry: ghcr.io
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}
      - name: Push latest and sha tags
        id: push
        uses: docker/build-push-action@v6
        with:
          context: .
          push: true
          tags: |
            ghcr.io/festoinc/layer-plan:latest
            ghcr.io/festoinc/layer-plan:sha-${{ steps.short.outputs.sha }}
          cache-from: type=gha
          build-args: |
            VERSION=${{ github.sha }}
            REVISION=${{ github.sha }}
      - name: Verify both tags share the pushed digest
        run: |
          # fail before cleanup if latest and sha-<short> do not resolve to
          # ${{ steps.push.outputs.digest }}
      - name: Delete older package versions
        uses: actions/delete-package-versions@v5
        with:
          package-name: layer-plan
          package-type: container
          min-versions-to-keep: 1
          delete-only-untagged-versions: false
      - name: Summary
        run: |
          # write image, digest and commit to $GITHUB_STEP_SUMMARY
```

Implementation details for the final workflow:

- The short SHA comes from
  `echo "sha=${GITHUB_SHA::7}" >> "$GITHUB_OUTPUT"` in a preceding step.
- The local smoke image is built first with `load: true` and the GHCR cache.
  The push step rebuilds from the same context and warm cache, then pushes both
  tags in one operation. This is what keeps the package to one version.
- `latest` and `sha-<short>` must resolve to the digest reported by the push
  step. If they do not, the job fails before cleanup, so older versions are not
  deleted and the broken state is visible. The same digest check runs again
  after cleanup to prove that pruning did not remove a retained tag.
- The cleanup action handles both user-owned and organization-owned packages,
  which avoids hard-coding `/users/` or `/orgs/` REST paths.
- Concurrency serializes Docker jobs: a newer main push waits for the running
  job. Combined with the tip-only trigger, the newest commit wins.
- No long-lived registry secret is added. `GITHUB_TOKEN` is scoped to
  `packages: write` for the job only.
- The job does not run on pull requests, forks or tags. Adding a `v*` tag
  trigger is out of scope.

### Smoke test

The runner starts the image with production-like settings, polls the health
endpoint and checks the packaged surfaces through
`scripts/docker-smoke.sh`:

```sh
IMAGE=layers-ci:smoke
NAME=layers-smoke

docker run -d --name "$NAME" -p 3001:3001 \
  -e HOST=0.0.0.0 \
  -e PORT=3001 \
  -e LAYERS_ALLOW_REMOTE=1 \
  -e LAYERS_DB_PATH=/app/data/layers.sqlite \
  -e LAYERS_SEED_SAMPLES=0 \
  -e LAYERS_SUPER_ADMIN_EMAIL=smoke@example.test \
  -e LAYERS_SUPER_ADMIN_PASSWORD=smoke-test-password-1 \
  "$IMAGE"

# poll http://127.0.0.1:3001/api/v1/health for up to 60 seconds
# require {"status":"ok","database":"ok"}
# require GET / to return 200 text/html (built UI is present)
# require GET /api/v1/openapi.json to return 200 application/json
# require POST /api/v1/test/reset to return 404 (test mode is off)
# require docker inspect .State.Health.Status == healthy (HEALTHCHECK works)
```

On failure, the step prints `docker logs "$NAME"`, `docker inspect` state and
exits non-zero. The container is removed in an `if: always()` step.

The smoke test does not sign in, create projects or test persistence; those are
covered by the existing API/Playwright suites on the runner and by the manual
remote checklist below.

### Why the image is not built on pull requests

PRs already run the full `verify` job. Building an image without pushing would
add minutes with no artefact. A broken Dockerfile is caught by the first main
push, after tests pass; the phase accepts this. A `pull_request` Docker build
can be added later if Dockerfile-only changes become frequent.

## 5. Registry and retention

### Public package

- First push creates the package `layer-plan` under `ghcr.io/festoinc`.
- GHCR packages default to private. After the first successful publish, open
  **Package settings → Danger zone → Change visibility → Public** once.
- Once public, the remote server can `docker pull` without `docker login`.
- The repository being public or private does not put any secret into the image;
  the image contains no `.env`, no database and no tokens.

### Tags and versions

| Tag | Meaning |
| --- | --- |
| `latest` | Newest main build |
| `sha-<7>` | Immutable identifier for that build |

- Both tags are pushed in one build operation and share one manifest digest.
  The cleanup action therefore keeps one package version carrying both tags.
- `min-versions-to-keep: 1` deletes every older version after the new one is
  verified. This satisfies "only the last image is available".
- Deletion is intentional and irreversible. There is no rollback to an older
  digest; a rollback means reverting the commit and pushing a new image.
- If the verification step finds that GHCR created two versions for the two
  tags, keep `min-versions-to-keep: 2` for that push, then replace the action
  with digest-aware deletion before the phase is marked delivered. The
  acceptance criteria require a single remaining version with both tags.

### Pull verification

After the first public push:

```sh
# on the remote server, without credentials
docker logout ghcr.io || true
docker pull ghcr.io/festoinc/layer-plan:latest
docker pull ghcr.io/festoinc/layer-plan:sha-<short>
```

Both pulls must succeed anonymously.

## 6. Documentation changes

### README

Add a **Docker** section after **Run**:

- image name, public package and tag scheme;
- `docker compose` workflow (copy `.env.example`, set credentials, pull, up);
- standalone `docker run` command;
- port mapping and `LAYERS_HTTP_PORT`;
- named volume, first start, persistence and super-admin sync;
- backup and restore commands;
- upgrade flow (`pull` then `up -d`) and the fact that old images are pruned;
- explicit boundaries: no nginx, no TLS, no automatic deployment, no ARM
  images, amd64 only.

Update **Runtime boundaries** to replace "No remote deployment" with the actual
state: a container image is published, deployment is still manual, TLS and
reverse proxying are still absent.

Update **Tests and tooling → CI** to mention the Docker job and its smoke test.

### `.env.example`

Add a short Docker block:

```sh
# Docker Compose on the remote server
# LAYERS_HTTP_PORT=80
```

Add a note that `HOST=0.0.0.0`, `LAYERS_ALLOW_REMOTE=1`, `LAYERS_DB_PATH` and
`LAYERS_SEED_SAMPLES=0` are image defaults already, and that
`LAYERS_SUPER_ADMIN_*` must be provided at runtime.

### `docs/api.md` and `AGENTS_template.md`

No changes. Docker does not alter the API, auth or agent contract.

## 7. Tests and quality gate

### Existing gate

Unchanged and must stay green:

```sh
npm run lint
npm run format:check
npm run typecheck
npm run test:unit
npm run test:api
npm run test:contract
npm run api:lint
npm run build
npm run test:e2e
npm run test:prod
```

`verify` continues to run these on the runner. No unit, API, contract or
Playwright test is added for Docker because the behaviour under test is the
image, not the application.

### Docker checks in CI

- `verify` passes before the Docker job starts.
- The builder stage completes `npm ci`, `npm run build` and
  `npm prune --omit=dev`.
- The runtime image starts with an empty volume, migrates SQLite and creates the
  super admin from env.
- Health, built UI, OpenAPI JSON and the test-mode-off check pass.
- The image's own `HEALTHCHECK` becomes `healthy`.
- Both tags are pushed and resolve to the same digest.
- Exactly one package version remains.

### Manual remote checklist

Run once on the provided server after the first public push:

1. `docker logout ghcr.io` then pull the image anonymously.
2. Copy `.env.example` to `.env`, set a strong super-admin password and start
   Compose.
3. Open `http://<server>/` and confirm the sign-in page loads.
4. Sign in, create a project, add a chapter and change something.
5. `docker compose restart app`; confirm the data is still there.
6. `docker compose pull && docker compose up -d`; confirm the data survives the
   container replacement.
7. `docker compose down -v` only on a scratch server; confirm a fresh start
   creates an empty workspace.
8. Confirm `docker compose ps` reports the container as healthy.
9. Confirm host port 80 (or `LAYERS_HTTP_PORT`) serves the app and `:3001` is not
   published unless configured.
10. Confirm no `.env`, `data/`, `tests/` or dev dependency is present inside the
    image (`docker run --rm --entrypoint sh <image> -c 'ls -la /app'`).

## 8. Acceptance criteria

- [ ] A push to `main` with a green `verify` job builds a `linux/amd64` image.
- [ ] A failing `verify` job, a pull request or a non-main branch publishes
      nothing.
- [ ] The image is public at `ghcr.io/festoinc/layer-plan` and pulls anonymously
      on the remote server.
- [ ] Every main push publishes `latest` and `sha-<7>`, both resolving to the
      same digest.
- [ ] Only the newest package version remains after the workflow finishes; older
      versions are deleted automatically.
- [ ] The image starts with runtime env only, runs migrations, creates the super
      admin and serves the built UI, API and OpenAPI document on `:3001`.
- [ ] `GET /api/v1/health` returns `{"status":"ok","database":"ok"}` and the
      image `HEALTHCHECK` becomes `healthy`.
- [ ] `LAYERS_TEST_MODE` is off in the image; `POST /api/v1/test/reset` returns
      `404`.
- [ ] The container runs as the non-root `node` user and has no `.env`, tests,
      source tree, dev dependencies, build toolchain or sample database inside.
- [ ] SQLite data in `/app/data` survives container restart and image upgrade
      through the `layers-data` named volume.
- [ ] `docker-compose.yml` starts the app with `.env`, publishes the configured
      host port and pulls `latest`.
- [ ] `LAYERS_SEED_SAMPLES=0` means a fresh install has no sample projects.
- [ ] The existing quality gate stays green.
- [ ] README, `.env.example` and the Compose file describe pull, run, upgrade,
      persistence, backup/restore and the no-nginx/no-TLS boundary.
- [ ] `phases/phase-ideas.md` no longer lists P-14.

## 9. Risks and mitigations

| Risk | Mitigation |
| --- | --- |
| Native modules fail to install or load in the runtime | Build on the same `bookworm-slim` base; keep `python3`/`make`/`g++` in the builder; copy the built `node_modules` rather than reinstalling in the runtime |
| `dist-server/index.js` is treated as CommonJS | Copy `package.json` with `"type": "module"` into the runtime stage; add a smoke-test startup check |
| Named volume is root-owned and SQLite cannot write | Create and `chown` `/app/data` in the image so Docker initializes the named volume as `node:node`; document `chown 1000:1000` for bind mounts |
| A secret or local database ends up in the image | `.dockerignore` excludes `.env*`, `data/`, `dist/`, `dist-server/`; acceptance check inspects `/app` |
| GHCR package stays private | One-time visibility toggle documented; anonymous pull is an acceptance test |
| Cleanup deletes a tag that `latest` still needs | Push both tags in one operation, verify both resolve to the pushed digest before cleanup, then keep one version; fall back to keeping two if GHCR splits versions |
| Old image versions are lost unexpectedly | This is the requested behaviour; the OCI revision label identifies the remaining image and a rollback is a new commit |
| Cleanup step fails after a successful push | The image is already published; rerun the cleanup or delete versions manually; the job fails loudly |
| Host port 80 is occupied | `LAYERS_HTTP_PORT` in `.env` selects another host port; the container port stays 3001 |
| No TLS and a public package | Do not expose the port publicly yet; use a private network/firewall; `LAYERS_SECURE_COOKIES` stays off until HTTPS is added |
| The smoke-tested image differs from the pushed image | Both builds use the same context, Dockerfile and GHCR cache; the push step reports the digest and the tag verification pins it |
| CI minutes grow | The Docker job runs only on main after `verify`; the builder uses GHA cache; no multi-arch QEMU builds |
| Image size includes unused UI dependencies | Accepted trade-off; prune dev dependencies only. Splitting production dependency lists is a later optimization |
| Compose `env_file: .env` is missing on the server | README runbook starts with `cp .env.example .env`; startup fails loudly on missing super-admin credentials |
| "Every commit" is not literally one image per commit | Push-trigger semantics are documented; the tip commit is built and intermediate commits are intentionally skipped |

## 10. Out of scope

- nginx, Caddy, Traefik or any reverse proxy.
- TLS certificates, HTTPS redirects, HSTS and `Secure` cookie rollout.
- Automated deployment, SSH commands, webhooks, Watchtower or server-side
  pull polling.
- Docker Hub, other registries or mirrored images.
- `linux/arm64` and multi-arch manifests.
- A development container, Compose watch mode or running Vite in Docker.
- Publishing the database, seed data or sample projects in the image.
- Postgres, a second database driver or storage changes (P-13).
- MCP exposure (P-15).
- Password rotation, recovery or secret managers (P-17).
- Image signing, SBOM attestation, vulnerability scanning gates or cosign.
- Zero-downtime upgrades, blue/green deployment or migration rollback.
- Automated backups, retention policies or off-server replication.
- Semver releases, changelogs and `v*` tag builds.
- Changes to application code, API, auth, OpenAPI or behaviour.
- Local Docker testing on the developer machine.

## 11. Delivery sequence

1. **Dockerfile and `.dockerignore`.** Two stages, runtime defaults, non-root
   user, data directory, healthcheck, labels. Confirm the image starts and the
   healthcheck passes.
2. **Compose and environment.** `docker-compose.yml`, `.env.example` Docker
   block, named volume, port mapping, `pull_policy`.
3. **CI wiring.** Permissions, Docker job condition, short-SHA step, build with
   GHA cache, smoke test, login, push both tags.
4. **Registry.** First publish, one-time public visibility change, anonymous
   pull verification on the remote server.
5. **Retention.** Digest verification step, cleanup action, confirm exactly one
   version with both tags remains; adjust to digest-aware deletion if needed.
6. **Documentation.** README Docker section, runtime boundaries, CI description,
   backup/restore, manual checklist.
7. **Validation.** Green `verify` on main, green Docker job, remote checklist,
   then mark the phase delivered and remove P-14 from the backlog.

## 12. Files

New:

```text
Dockerfile
.dockerignore
docker-compose.yml
scripts/docker-smoke.sh
phases/phase_8_docker_image.md
```

Modified:

```text
.github/workflows/ci.yml   top-level permissions, docker job, smoke test, push, prune
README.md                  Docker runbook, persistence, backup, boundaries, CI
.env.example               Docker Compose port and image-default notes
phases/phase-ideas.md      remove P-14, keep P-15 and later ideas
```

No application source, API, schema, migration or test file changes.

## 13. Backlog relationship

- Phase 8 delivers **P-14 — Docker**. Remove P-14 from
  `phases/phase-ideas.md` when the phase is delivered.
- **P-15 — MCP** is unaffected; it will run against the same container and API.
- **P-13 — SQLite and Postgres** is unaffected; the image keeps SQLite on a
  named volume.
- **P-17 — Password change and recovery** becomes more relevant once the
  container is deployed, because the super-admin password currently lives only
  in the server `.env`.
- **P-03 — Cross-device sync and cloud backup** remains separate; Phase 8 adds
  manual volume backup, not a sync service.
- Phase 7 commit references are unrelated to the image build. Phase 8 builds
  whatever is on `main`, so ordering between phase 7 and phase 8 does not
  matter.
