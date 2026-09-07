#!/usr/bin/env bash
#
# Loads the image tarball on the target server.
#
#   ./scripts/load-images.sh images/asset-management-1.0.0.tar.gz
#
# After this, `docker compose up -d` finds every image locally. Do NOT run
# `docker compose pull` on this deployment — there is no registry behind these
# tags and the pull will fail.

set -euo pipefail

bundle="${1:-}"

if [[ -z "$bundle" ]]; then
  echo "usage: $0 <asset-management-<tag>.tar.gz>" >&2
  exit 64
fi

if [[ ! -f "$bundle" ]]; then
  echo "no such file: $bundle" >&2
  exit 66
fi

echo "==> loading images from $bundle"
gunzip -c "$bundle" | docker load

echo
echo "==> loaded"
docker images --filter=reference='asset-management/*' \
  --format 'table {{.Repository}}\t{{.Tag}}\t{{.Size}}'
