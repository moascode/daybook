#!/usr/bin/env bash
#
# package-release.sh — assemble a deployable Daybook release artifact.
#
# Produces a self-contained tarball that the Mac deploy tool
# (`infra/daybook deploy`) downloads from a GitHub Release and unpacks over the
# install directory. The artifact ships the *built* frontend plus the server
# TypeScript source (run via tsx) and the dependency manifests — native modules
# (better-sqlite3, bcrypt) are compiled on the target machine by `npm ci`.
#
# Usage:
#   scripts/package-release.sh [version]
#
#   version   Release version (e.g. 1.2.0). Defaults to $VERSION env var, then
#             `git describe`. A leading "v" is stripped.
#
# Output (written to dist-release/):
#   daybook-<version>.tar.gz
#   daybook-<version>.tar.gz.sha256
#
# Run `npm run build` before this, or pass --build to do it here.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$ROOT_DIR"

DO_BUILD=0
ARG_VERSION=""
for arg in "$@"; do
  case "$arg" in
    --build) DO_BUILD=1 ;;
    *)       ARG_VERSION="$arg" ;;
  esac
done

# Resolve the version: explicit arg → $VERSION → git describe → 0.0.0-dev.
VERSION="${ARG_VERSION:-${VERSION:-}}"
if [ -z "$VERSION" ]; then
  VERSION="$(git describe --tags --always --dirty 2>/dev/null || echo '0.0.0-dev')"
fi
VERSION="${VERSION#v}" # strip a leading v (v1.2.0 → 1.2.0)

OUT_DIR="$ROOT_DIR/dist-release"
STAGE_DIR="$OUT_DIR/stage"
ARTIFACT="$OUT_DIR/daybook-$VERSION.tar.gz"

echo "› Packaging Daybook release $VERSION"

if [ "$DO_BUILD" = "1" ]; then
  echo "› Building frontend…"
  npm run build
fi

[ -f "$ROOT_DIR/dist/index.html" ] || {
  echo "✗ dist/index.html not found — run 'npm run build' first (or pass --build)." >&2
  exit 1
}

# ── Stage the artifact contents ──────────────────────────────────────────────
rm -rf "$STAGE_DIR"
mkdir -p "$STAGE_DIR"

# Built frontend + server source + the control/deploy tool + dependency lock.
cp -R "$ROOT_DIR/dist"            "$STAGE_DIR/dist"
cp -R "$ROOT_DIR/server"          "$STAGE_DIR/server"
mkdir -p "$STAGE_DIR/infra" "$STAGE_DIR/scripts"
cp    "$ROOT_DIR/infra/daybook"   "$STAGE_DIR/infra/daybook"
cp    "$SCRIPT_DIR/package-release.sh" "$STAGE_DIR/scripts/package-release.sh"
cp    "$ROOT_DIR/package.json"    "$STAGE_DIR/package.json"
cp    "$ROOT_DIR/package-lock.json" "$STAGE_DIR/package-lock.json"
cp    "$ROOT_DIR/tsconfig.json"   "$STAGE_DIR/tsconfig.json"
cp    "$ROOT_DIR/tsconfig.node.json" "$STAGE_DIR/tsconfig.node.json"
[ -f "$ROOT_DIR/.env.example" ] && cp "$ROOT_DIR/.env.example" "$STAGE_DIR/.env.example"

# Never ship local databases, runtime files, or build inputs the target rebuilds.
rm -rf "$STAGE_DIR/server/data"

# A manifest so the deployed machine (and humans) can see exactly what's running.
cat > "$STAGE_DIR/VERSION" <<EOF
version=$VERSION
commit=$(git rev-parse HEAD 2>/dev/null || echo unknown)
built_at=$(date -u +%Y-%m-%dT%H:%M:%SZ)
EOF

# ── Create the tarball + checksum ────────────────────────────────────────────
mkdir -p "$OUT_DIR"
rm -f "$ARTIFACT" "$ARTIFACT.sha256"
tar -czf "$ARTIFACT" -C "$STAGE_DIR" .

# sha256sum (Linux/CI) or shasum (macOS) — emit a checksum line the deploy tool
# verifies with `shasum -c`. Reference just the basename so the file is portable.
( cd "$OUT_DIR"
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$(basename "$ARTIFACT")" > "$ARTIFACT.sha256"
  else
    shasum -a 256 "$(basename "$ARTIFACT")" > "$ARTIFACT.sha256"
  fi
)

rm -rf "$STAGE_DIR"

echo "✓ Built $ARTIFACT"
echo "✓ Built $ARTIFACT.sha256"

# Expose the resolved version to a calling workflow (GitHub Actions).
if [ -n "${GITHUB_OUTPUT:-}" ]; then
  {
    echo "version=$VERSION"
    echo "artifact=$ARTIFACT"
    echo "checksum=$ARTIFACT.sha256"
  } >> "$GITHUB_OUTPUT"
fi
