#!/usr/bin/env bash
set -euo pipefail

# Starts the built image and checks the packaged production surfaces.
# Usage: bash scripts/docker-smoke.sh [image]
# Requires: docker, curl

IMAGE="${1:-layers-ci:smoke}"
NAME="${SMOKE_CONTAINER_NAME:-layers-smoke-${GITHUB_RUN_ID:-local-$$}}"
HOST_PORT="${SMOKE_PORT:-3001}"
BASE_URL="http://127.0.0.1:${HOST_PORT}"

cleanup() {
  docker rm --force "$NAME" >/dev/null 2>&1 || true
}
trap cleanup EXIT

fail() {
  echo "Smoke test failed: $*" >&2
  echo "--- docker logs ---" >&2
  docker logs "$NAME" >&2 || true
  echo "--- container state ---" >&2
  docker inspect "$NAME" >&2 || true
  exit 1
}

echo "Starting $IMAGE as $NAME on port $HOST_PORT"
docker run --detach --name "$NAME" \
  --publish "127.0.0.1:${HOST_PORT}:3001" \
  --env HOST=0.0.0.0 \
  --env PORT=3001 \
  --env LAYERS_ALLOW_REMOTE=1 \
  --env LAYERS_DB_PATH=/app/data/layers.sqlite \
  --env LAYERS_SEED_SAMPLES=0 \
  --env LAYERS_SUPER_ADMIN_EMAIL=smoke@example.test \
  --env LAYERS_SUPER_ADMIN_PASSWORD=smoke-test-password-1 \
  "$IMAGE" >/dev/null

echo "Waiting for /api/v1/health"
health=""
for _ in $(seq 1 30); do
  if health="$(curl --silent --show-error --fail "$BASE_URL/api/v1/health" 2>/dev/null)"; then
    if printf '%s' "$health" | grep -q '"status":"ok"' &&
      printf '%s' "$health" | grep -q '"database":"ok"'; then
      break
    fi
  fi
  health=""
  sleep 2
done
[ -n "$health" ] || fail "health endpoint did not become ready"

echo "Health: $health"

status="$(curl --silent --output /dev/null --write-out '%{http_code}' "$BASE_URL/")"
[ "$status" = "200" ] || fail "GET / returned $status"

content_type="$(curl --silent --output /dev/null --write-out '%{content_type}' "$BASE_URL/")"
case "$content_type" in
  text/html*) ;;
  *) fail "GET / returned content type $content_type" ;;
esac

status="$(curl --silent --output /dev/null --write-out '%{http_code}' "$BASE_URL/api/v1/openapi.json")"
[ "$status" = "200" ] || fail "GET /api/v1/openapi.json returned $status"

status="$(curl --silent --output /dev/null --write-out '%{http_code}' \
  --request POST "$BASE_URL/api/v1/test/reset")"
[ "$status" = "404" ] || fail "test reset returned $status, expected 404"

user="$(docker inspect --format '{{.Config.User}}' "$NAME")"
[ "$user" = "node" ] || fail "container runs as user '$user', expected 'node'"

echo "Waiting for Docker healthcheck"
docker_health=""
for _ in $(seq 1 45); do
  docker_health="$(docker inspect \
    --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' \
    "$NAME" 2>/dev/null || echo missing)"
  case "$docker_health" in
    healthy) break ;;
    unhealthy) fail "Docker healthcheck reported unhealthy" ;;
  esac
  sleep 2
done
[ "$docker_health" = "healthy" ] || fail "Docker healthcheck did not become healthy"

echo "Smoke test passed"
