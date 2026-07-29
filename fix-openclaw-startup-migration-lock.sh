#!/usr/bin/env bash
set -euo pipefail

pick_container() {
  if [[ $# -gt 0 && -n "${1:-}" ]]; then
    printf '%s\n' "$1"
    return
  fi

  for name in openclaw-gateway-1 openclaw-openclaw-gateway-1; do
    if docker inspect "$name" >/dev/null 2>&1; then
      printf '%s\n' "$name"
      return
    fi
  done

  docker ps -a --format '{{.Names}}' | grep -E 'openclaw.*gateway|gateway.*openclaw' | head -n 1
}

CONTAINER_NAME="$(pick_container "${1:-}")"
if [[ -z "${CONTAINER_NAME}" ]]; then
  echo "Could not find an OpenClaw gateway container. Pass the container name explicitly." >&2
  exit 1
fi

if ! docker inspect "${CONTAINER_NAME}" >/dev/null 2>&1; then
  echo "Container not found: ${CONTAINER_NAME}" >&2
  exit 1
fi

IMAGE_NAME="${2:-$(docker inspect -f '{{.Config.Image}}' "${CONTAINER_NAME}")}"
if [[ -z "${IMAGE_NAME}" ]]; then
  echo "Could not resolve image for ${CONTAINER_NAME}. Pass the image name as the second argument." >&2
  exit 1
fi

echo "Container: ${CONTAINER_NAME}"
echo "Helper image: ${IMAGE_NAME}"

echo "Stopping ${CONTAINER_NAME}..."
docker stop "${CONTAINER_NAME}" >/dev/null || true

run_helper() {
  docker run --rm \
    --user 0 \
    --volumes-from "${CONTAINER_NAME}" \
    --entrypoint sh \
    "${IMAGE_NAME}" \
    -lc "$1"
}

clear_lock='set -eu
STATE_DIR="${OPENCLAW_STATE_DIR:-/home/node/.openclaw}"
DB_PATH="$STATE_DIR/state/openclaw.sqlite"
if [ ! -f "$DB_PATH" ]; then
  echo "State DB not found at $DB_PATH" >&2
  echo "Candidates:" >&2
  find /home /root -path "*/.openclaw/state/openclaw.sqlite" -print 2>/dev/null || true
  exit 1
fi
p="$STATE_DIR/workspace/default/memory/.dreams/short-term-recall.json"
if [ -f "$p" ]; then
  mv "$p" "$p.manual-backup-$(date +%Y%m%d%H%M%S)"
  echo "backed up $p"
else
  echo "no legacy short-term recall file found at $p"
fi
DB_PATH="$DB_PATH" node --input-type=module <<'"'"'NODE'"'"'
import { DatabaseSync } from "node:sqlite";
const dbPath = process.env.DB_PATH;
const db = new DatabaseSync(dbPath);
const before = db.prepare(
  "SELECT scope, lease_key, owner, expires_at FROM state_leases WHERE scope = ? AND lease_key = ?"
).all("startup-migrations", "global");
console.log("startup migration lease rows before: " + JSON.stringify(before));
const result = db.prepare(
  "DELETE FROM state_leases WHERE scope = ? AND lease_key = ?"
).run("startup-migrations", "global");
console.log("deleted startup migration lease rows: " + result.changes);
const after = db.prepare(
  "SELECT scope, lease_key, owner, expires_at FROM state_leases WHERE scope = ? AND lease_key = ?"
).all("startup-migrations", "global");
console.log("startup migration lease rows after: " + JSON.stringify(after));
db.close();
NODE'

echo "Clearing stale startup migration lease..."
run_helper "$clear_lock"

echo "Running openclaw doctor --fix against mounted state/config..."
set +e
docker run --rm \
  --user node \
  --volumes-from "${CONTAINER_NAME}" \
  --entrypoint sh \
  -e HOME=/home/node \
  -e OPENCLAW_STATE_DIR=/home/node/.openclaw \
  "${IMAGE_NAME}" \
  -lc 'openclaw doctor --fix'
doctor_status=$?
set -e

if [[ $doctor_status -ne 0 ]]; then
  echo "openclaw doctor --fix failed with exit code ${doctor_status}. Leaving gateway stopped so logs are not hidden by restart loop." >&2
  echo "Clearing lease left by failed doctor run..." >&2
  run_helper "$clear_lock" || true
  exit "$doctor_status"
fi

echo "Clearing startup migration lease after doctor --fix..."
run_helper "$clear_lock"

echo "Starting ${CONTAINER_NAME}..."
docker start "${CONTAINER_NAME}" >/dev/null

echo "Done. Check logs with: docker logs -f ${CONTAINER_NAME}"
