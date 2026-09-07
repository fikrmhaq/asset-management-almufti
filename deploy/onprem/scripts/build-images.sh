#!/usr/bin/env bash
#
# Builds the deployment images and saves them as ONE portable tarball.
#
# Run this on a machine that HAS the source tree and Docker — your laptop or a
# CI runner — not on the target server, which never needs the source.
#
#   ./scripts/build-images.sh            # tags 1.0.0
#   ./scripts/build-images.sh 1.1.0      # tags 1.1.0
#
# The output goes to `images/` and is git-ignored on purpose: it is 300-500 MB,
# and GitHub refuses any file over 100 MB. Carry it to the server by USB, scp or
# a file share, then run `scripts/load-images.sh` there.

set -euo pipefail

TAG="${1:-1.0.0}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PACKAGE_DIR="$(dirname "$SCRIPT_DIR")"
REPO_ROOT="$(cd "$PACKAGE_DIR/../.." && pwd)"

API_IMAGE="asset-management/api:$TAG"
WEB_IMAGE="asset-management/web:$TAG"

# The stack runs four images, not two. A server with no registry access needs
# every one of them in the tarball, and the base images are the ones people
# forget until `up -d` fails on a machine with no internet.
BASE_IMAGES=(postgres:16-alpine redis:7-alpine nginx:1.27-alpine)

if [[ ! -f "$REPO_ROOT/apps/api/Dockerfile" ]]; then
  echo "cannot find the source tree at $REPO_ROOT" >&2
  echo "run this script from inside the repository, not from an extracted package" >&2
  exit 66
fi

echo "==> building $API_IMAGE"
docker build -f "$REPO_ROOT/apps/api/Dockerfile" -t "$API_IMAGE" "$REPO_ROOT"

# VITE_API_BASE_URL is inlined at BUILD time by Vite. The relative `/api/v1` is
# what makes one image work at any hostname or IP: the browser calls the same
# origin it loaded the page from, so moving the server needs no rebuild.
echo "==> building $WEB_IMAGE"
docker build -f "$REPO_ROOT/apps/web/Dockerfile" \
  --build-arg VITE_API_BASE_URL=/api/v1 \
  -t "$WEB_IMAGE" "$REPO_ROOT"

echo "==> pulling base images"
for image in "${BASE_IMAGES[@]}"; do
  docker pull "$image"
done

mkdir -p "$PACKAGE_DIR/images"
bundle="$PACKAGE_DIR/images/asset-management-$TAG.tar.gz"

echo "==> saving all four images to $bundle"
docker save "$API_IMAGE" "$WEB_IMAGE" "${BASE_IMAGES[@]}" | gzip > "$bundle"

size="$(du -h "$bundle" | cut -f1)"

cat <<SUMMARY

Done. $bundle ($size)

Copy to the server, then there:

  ./scripts/load-images.sh images/asset-management-$TAG.tar.gz

If TAG is not 1.0.0, set these in the server's .env:

  API_IMAGE=$API_IMAGE
  WEB_IMAGE=$WEB_IMAGE
SUMMARY
