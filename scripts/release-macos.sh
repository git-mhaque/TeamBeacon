#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'USAGE'
Usage: ./scripts/release-macos.sh <version>

Examples:
  ./scripts/release-macos.sh 0.3.0
  ./scripts/release-macos.sh 0.3.1-rc.1

What it does:
  1. Validates clean git state on main
  2. Updates app/src-tauri/tauri.conf.json version
  3. Commits version bump (if needed)
  4. Creates and pushes tag v<version>
  5. Triggers GitHub Actions macOS release workflow
USAGE
}

VERSION="${1:-}"
if [[ -z "${VERSION}" ]]; then
  usage
  exit 1
fi

if ! [[ "${VERSION}" =~ ^[0-9]+\.[0-9]+\.[0-9]+([.-][0-9A-Za-z.-]+)?$ ]]; then
  echo "Invalid version '${VERSION}'. Use semver, e.g. 0.3.0 or 0.3.1-rc.1" >&2
  exit 1
fi

TAG="v${VERSION}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

cd "${REPO_ROOT}"

CURRENT_BRANCH="$(git branch --show-current)"
if [[ "${CURRENT_BRANCH}" != "main" ]]; then
  echo "Release must be cut from 'main'. Current branch: ${CURRENT_BRANCH}" >&2
  exit 1
fi

if ! git diff --quiet || ! git diff --cached --quiet; then
  echo "Working tree is not clean. Commit/stash changes before releasing." >&2
  exit 1
fi

if git rev-parse "${TAG}" >/dev/null 2>&1; then
  echo "Tag ${TAG} already exists locally." >&2
  exit 1
fi

if git ls-remote --exit-code --tags origin "refs/tags/${TAG}" >/dev/null 2>&1; then
  echo "Tag ${TAG} already exists on origin." >&2
  exit 1
fi

node - "${VERSION}" <<'NODE'
const fs = require('fs');
const path = 'app/src-tauri/tauri.conf.json';
const version = process.argv[2];
const config = JSON.parse(fs.readFileSync(path, 'utf8'));
config.version = version;
fs.writeFileSync(path, `${JSON.stringify(config, null, 2)}\n`);
NODE

git add app/src-tauri/tauri.conf.json
if ! git diff --cached --quiet; then
  git commit -m "chore(release): cut macOS ${TAG}"
else
  echo "Version already set to ${VERSION}; skipping version bump commit."
fi

git tag "${TAG}"

git push origin main
git push origin "${TAG}"

echo "Release tag pushed: ${TAG}"
echo "GitHub Actions workflow 'Release macOS Desktop' will publish a draft release."
