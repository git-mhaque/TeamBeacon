#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
ACTION="${1:-}"

ensure_rust_toolchain() {
  if command -v cargo >/dev/null 2>&1 && command -v rustc >/dev/null 2>&1; then
    return 0
  fi

  if [ -f "${HOME}/.cargo/env" ]; then
    # shellcheck source=/dev/null
    . "${HOME}/.cargo/env"
  fi

  if command -v cargo >/dev/null 2>&1 && command -v rustc >/dev/null 2>&1; then
    return 0
  fi

  cat >&2 <<'EOF'
Rust toolchain not found on PATH.

Install once:
  xcode-select -p || xcode-select --install
  curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
  source "$HOME/.cargo/env"

Then re-run:
  npm run desktop:dev
EOF
  exit 1
}

run_tauri() {
  case "${ACTION}" in
    dev)
      npm run tauri -- dev
      ;;
    build)
      npm run tauri -- build
      ;;
    *)
      echo "Usage: ./scripts/tauri-with-rust.sh <dev|build>" >&2
      exit 2
      ;;
  esac
}

cd "${APP_DIR}"
ensure_rust_toolchain
run_tauri

