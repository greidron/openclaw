#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
IMAGE_NAME="${OPENCLAW_IMAGE:-openclaw:local}"
OPENCLAW_EXTENSIONS="${OPENCLAW_EXTENSIONS:-slack,codex,google}"
OPENCLAW_DOCKER_APT_PACKAGES="${OPENCLAW_DOCKER_APT_PACKAGES:-}"

echo "==> Building Docker image: ${IMAGE_NAME}"
docker build \
  --build-arg "OPENCLAW_EXTENSIONS=${OPENCLAW_EXTENSIONS}" \
  --build-arg "OPENCLAW_DOCKER_APT_PACKAGES=${OPENCLAW_DOCKER_APT_PACKAGES}" \
  -t "${IMAGE_NAME}" \
  -f "${ROOT_DIR}/Dockerfile" \
  "${ROOT_DIR}"
