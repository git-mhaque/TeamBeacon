#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

"${SCRIPT_DIR}/run-api.sh" &
API_PID=$!

cleanup() {
  if kill -0 "${API_PID}" >/dev/null 2>&1; then
    kill "${API_PID}" >/dev/null 2>&1 || true
    wait "${API_PID}" 2>/dev/null || true
  fi
}

trap cleanup EXIT INT TERM

wait_for_api() {
  local retries=40
  local index=1

  while [ "${index}" -le "${retries}" ]; do
    if ! kill -0 "${API_PID}" >/dev/null 2>&1; then
      echo "Local API failed to start. Check port 8000 availability and API logs."
      return 1
    fi

    if curl -fsS "http://127.0.0.1:8000/health" >/dev/null 2>&1; then
      return 0
    fi

    sleep 0.25
    index=$((index + 1))
  done

  echo "Timed out waiting for local API health endpoint on 127.0.0.1:8000."
  return 1
}

wait_for_api
npm run dev:ui
