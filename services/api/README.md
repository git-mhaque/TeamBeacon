# TeamBeacon Local API

Lightweight local API endpoints used by the desktop/web shell.

## Run
From repository root:

```bash
python3 -m services.api.server --host 127.0.0.1 --port 8000
```

## Endpoints
- `GET /health`
- `GET /api/integrations/jira/status`
- `GET /api/integrations/jira/sync/status`
- `POST /api/integrations/jira/sync/start`
  - Optional JSON body: `{"mode":"full"}` or `{"mode":"since_last"}`
  - `since_last` uses an internal 2-day overlap from the previous sync timestamp

## Notes
- The JIRA status endpoint reads `config/.env` (or process env vars).
- JIRA sync persists board/sprint/issue data to local SQLite (`teambeacon.db` by default).
- Intended for local desktop runtime and frontend proxy usage.
