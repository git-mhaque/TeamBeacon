# TeamBeacon dashboard MCP

Read-only access to the running TeamBeacon API, with an optional MCP Apps dashboard widget. The adapter never opens SQLite, loads PATs, calls a model, or starts a sync.

## Install and connect

From the repository root, using Python 3.11+ and the existing Node prerequisites:

```bash
python3.11 -m venv .venv-mcp
.venv-mcp/bin/python -m pip install -r services/mcp/requirements.lock
cd app
npm ci
npm run build:mcp
cd ..
codex mcp add teambeacon \
  --env "PYTHONPATH=$PWD" \
  --env TEAMBEACON_API_URL=http://127.0.0.1:8000 \
  --env TEAMBEACON_UI_URL=http://127.0.0.1:5174 \
  --env TEAMBEACON_TIMEZONE=Australia/Melbourne \
  -- "$PWD/.venv-mcp/bin/python" -m services.mcp
codex mcp list
```

Keep the API running. Restart an already-running API once after upgrading to pick up the checkpoint-only freshness read. Reconnect/restart Codex if the tools are not listed, then ask **“Show the TeamBeacon dashboard.”** Use **“Summarize the TeamBeacon dashboard”** for a data-only answer. From this repository, `.venv-mcp/bin/python -m services.mcp` starts the stdio server directly; stdout is reserved for MCP messages.

## Capabilities

| Name | Behavior |
| --- | --- |
| `get_team_dashboard` | Structured dashboard facts, warnings and applied filters |
| `show_teambeacon_dashboard` | Same facts plus the MCP Apps UI association |
| `ui://teambeacon/dashboard/v1.html` | Bundled HTML/React dashboard with no remote assets |
| `teambeacon://workspace` | Timezone, UI URL and read-only capabilities |
| `teambeacon://metric-definitions` | Flow, scope, cycle-time and freshness definitions |

Both tools accept `flow_weeks` (1/4/12; default 4), `recent_limit` (1–20; default 5), an optional IANA `timezone`, and optional `cycle_time_status_keys`. Omit status keys for backend defaults; `[]` explicitly selects no statuses. Browser preferences are separate. The widget preserves timezone and status selections when changing its flow window.

The compact widget offers work-stream progress and flow, period/work-stream filtering, and data freshness. Detailed highlights and issue lists remain in the data-tool result and full web UI. “Update view” re-reads the API, which may reuse its analytics cache; it never syncs JIRA. Limited lists retain totals. Missing/partial data is labeled. No edit, delete, sync, credential or arbitrary-query tools are registered.

For the concepts and implementation journey, read the [illustrated HTML tutorial](../../docs/tutorials/web-app-to-mcp.html).

## Local boundary and compatibility

The environment variables above default to those values. URLs must be HTTP loopback origins without credentials, query or paths. Redirects and environment HTTP proxies are disabled. For Docker, use the published local API port. Results discard unknown fields, sanitize operational errors, cap upstream responses at 512 KB, and return at most 50 work streams plus bounded issue details.

The widget uses the standard MCP Apps JSON-RPC bridge from the [official quickstart](https://developers.openai.com/plugins/build/app-quickstart). It calls the host, not localhost directly. Run `npm run build:mcp` after widget edits; the generated `services/mcp/ui/` directory is ignored by Git. No new frontend dependency is required.

Protocol tests and a local browser bridge preview are available for validation. Native rendering of a custom local stdio MCP App in the installed Codex client still needs a manual check; discovery alone does not prove UI support. If only text appears, use the data tool and the local web UI while checking client support. Do not expose the API publicly to solve compatibility.

## Validate

Build the widget first, then run:

```bash
.venv-mcp/bin/python -m pip install -r services/mcp/requirements-dev.lock
.venv-mcp/bin/ruff check --config services/mcp/ruff.toml services/mcp tests/mcp
.venv-mcp/bin/python -m coverage run --branch --source=services.mcp -m unittest discover -s tests/mcp -v
.venv-mcp/bin/python -m coverage report --fail-under=90
cd app
npm run typecheck && npm run lint && npm run build && npm run build:mcp && npm run test:coverage
```

The protocol test starts a fixture-backed HTTP API and spawns the real stdio server with the official MCP client. It validates schemas, compares data/render results and reads the UI resource without contacting JIRA or using production data. Frontend tests cover host messages, source/origin checks, timeouts, filters, stale responses, partial/empty states and unsafe links. Run normal backend regression tests for the freshness-reader change as well.

Validation snapshot (2026-10-14): 155 backend unit tests, 70 API integration tests, 11 MCP tests and 132 frontend tests passed. The MCP Python modules have 100% line/branch coverage; the widget and bridge exceed 95% across enforced frontend metrics. All 10 executable lines in the new freshness reader are covered. Typecheck, builds, MCP lint and syntax checks pass; frontend lint retains nine pre-existing warnings. A live stdio call returned the running instance's eight work streams, and the local browser preview rendered the live dashboard.

Additional regression tests cover HTTP validation, cache invalidation, server lifecycle, JIRA payload boundaries, checkpoint cursor precedence and interrupted-run recovery. Combined statement/branch coverage is now 99.72% for `services/api/server.py` and 94.79% for `jira_sync.py`. CI enforces the 90% gate separately for each module; see the [backend coverage commands](../../README.md). Native widget rendering still requires verification in the target MCP Apps host.

### Compact widget scope

The widget shows work-stream progress and flow with period/work-stream filters and data freshness. Metric highlights, blocker/recent-completion lists, cycle-time status text, and issue-list truncation notices are omitted. Detailed data remains available to chat through the same read tools and in the full web UI. Relevant data-availability warnings remain visible.
