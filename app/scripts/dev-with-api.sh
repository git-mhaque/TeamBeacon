#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
LOG_DIR="${TEAMBEACON_LOG_DIR:-${REPO_ROOT}/logs}"
API_LOG="${LOG_DIR}/api.log"
APP_LOG="${LOG_DIR}/app.log"

mkdir -p "${LOG_DIR}"
printf '\n[%s] Starting TeamBeacon dev API\n' "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" >> "${API_LOG}"
printf '\n[%s] Starting TeamBeacon frontend dev server\n' "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" >> "${APP_LOG}"
echo "Writing API logs to ${API_LOG}"
echo "Writing frontend logs to ${APP_LOG}"

kill_port_listeners() {
  local port="$1"
  local pids
  pids="$(lsof -tiTCP:"${port}" -sTCP:LISTEN || true)"

  if [ -z "${pids}" ]; then
    return
  fi

  echo "Stopping existing listeners on port ${port}: ${pids}"
  for pid in ${pids}; do
    kill "${pid}" >/dev/null 2>&1 || true
  done

  sleep 0.3

  pids="$(lsof -tiTCP:"${port}" -sTCP:LISTEN || true)"
  if [ -z "${pids}" ]; then
    return
  fi

  echo "Force-stopping remaining listeners on port ${port}: ${pids}"
  for pid in ${pids}; do
    kill -9 "${pid}" >/dev/null 2>&1 || true
  done
}

ensure_port_free() {
  local port="$1"
  local pids
  pids="$(lsof -tiTCP:"${port}" -sTCP:LISTEN || true)"
  if [ -n "${pids}" ]; then
    echo "Unable to free port ${port}. Still listening PID(s): ${pids}"
    echo "Please stop those processes manually, then retry npm run dev."
    exit 1
  fi
}

kill_port_listeners 8000
kill_port_listeners 5174
ensure_port_free 8000
ensure_port_free 5174

API_PID=""
FRONTEND_PID=""

terminate_process() {
  local name="$1"
  local pid="$2"

  if [ -z "${pid}" ]; then
    return
  fi

  if kill -0 "${pid}" >/dev/null 2>&1; then
    echo "Stopping ${name} process: ${pid}"
    kill "${pid}" >/dev/null 2>&1 || true
    wait "${pid}" 2>/dev/null || true
  fi
}

cleanup() {
  local status="${1:-$?}"
  trap - EXIT INT TERM
  terminate_process "frontend" "${FRONTEND_PID}"
  terminate_process "API" "${API_PID}"
  kill_port_listeners 5174
  kill_port_listeners 8000
  exit "${status}"
}

trap 'cleanup $?' EXIT
trap 'cleanup 130' INT
trap 'cleanup 143' TERM

"${SCRIPT_DIR}/run-api.sh" >> "${API_LOG}" 2>&1 &
API_PID=$!

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
npm run dev:web >> "${APP_LOG}" 2>&1 &
FRONTEND_PID=$!

wait "${FRONTEND_PID}"
