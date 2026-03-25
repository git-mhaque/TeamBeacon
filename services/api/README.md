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
- `GET /api/integrations/jira/sync/history?limit=30`
- `GET /api/issues/search`
  - Optional query params:
    - `epicKey=CEGBUPOL-4482`
    - `workedBy=user-qa` (matches assignee/reporter/changelog contributor)
    - `assignee=<accountId>`, `reporter=<accountId>`
    - `issueType=Story`, `status=In Progress`
    - `updatedSince=2026-03-01T00:00:00+00:00`, `updatedUntil=2026-03-31T23:59:59+00:00`
    - `limit=100` (1-500)

## Notes
- The JIRA status endpoint reads `config/.env` (or process env vars).
- JIRA sync persists board/sprint/issue/changelog data to local SQLite (`teambeacon.db` by default).
- Parent-child lineage is stored on `issues.parent_issue_key`; epic linkage is stored on `issues.epic_key`.
- Intended for local desktop runtime and frontend proxy usage.
