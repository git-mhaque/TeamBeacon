#!/usr/bin/env sh
set -eu

DB_PATH="${TEAMBEACON_DB_PATH:-/data/teambeacon.db}"
INIT_DB="${TEAMBEACON_INIT_DB:-1}"

mkdir -p "$(dirname "${DB_PATH}")"

if [ "${INIT_DB}" = "1" ] && [ ! -f "${DB_PATH}" ]; then
  TEAMBEACON_DB_PATH="${DB_PATH}" python3 - <<'PY'
import os
import sqlite3
from pathlib import Path


db_path = Path(os.environ.get("TEAMBEACON_DB_PATH", "/data/teambeacon.db"))
migration_path = Path("/app/services/api/db/migrations/0001_initial.sql")

if not migration_path.is_file():
    raise SystemExit(f"Migration file not found: {migration_path}")

conn = sqlite3.connect(db_path)
try:
    conn.executescript(migration_path.read_text(encoding="utf-8"))
    conn.commit()
finally:
    conn.close()

print(f"Initialized TeamBeacon database at {db_path}")
PY
fi

# Keep one shared config/.env for local + docker:
# local runtime uses OLLAMA_BASE_URL, container runtime prefers OLLAMA_BASE_URL_DOCKER.
if [ -n "${OLLAMA_BASE_URL_DOCKER:-}" ]; then
  export OLLAMA_BASE_URL="${OLLAMA_BASE_URL_DOCKER}"
fi

exec python3 -m services.api.server \
  --host "${TEAMBEACON_HOST:-0.0.0.0}" \
  --port "${TEAMBEACON_PORT:-8000}" \
  --web-dir "${TEAMBEACON_WEB_DIR:-/app/app/web}"
