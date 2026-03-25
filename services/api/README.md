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
  - Optional JSON body:
    - `{"mode":"full"}`
    - `{"mode":"since_last"}`
    - `{"mode":"since_date","sinceDate":"2026-03-01"}`
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
- `GET /api/metadata/lookup`
  - Returns lookup/reference data:
    - `groups` (epic groups)
    - `workTypes` (work-type taxonomy)
- `POST /api/metadata/lookup/groups`
  - Body: `{"name":"Platform"}`
- `POST /api/metadata/lookup/work-types`
  - Body: `{"name":"Feature"}`
- `GET /api/metadata/epics?limit=50`
  - Optional query param: `epicKey=CEGBUPOL-4482`
- `GET /api/metadata/epics/summary?limit=50`
  - Returns configured epics with completion metrics derived from local synced issue cards.
- `GET /api/metadata/epics/candidates?q=<key-or-name>&limit=20`
  - Returns unconfigured epic candidates from local synced `issues` (issue type `Epic`).
- `POST /api/metadata/epics`
  - Body:
    - `epicKey` (required)
    - `successCriteria` (string array)
    - `groupIds` (int array)
    - `workTypeIds` (int array)

## Notes
- The JIRA status endpoint reads `config/.env` (or process env vars).
- JIRA sync persists board/sprint/issue/changelog data to local SQLite (`teambeacon.db` by default).
- Parent-child lineage is stored on `issues.parent_issue_key`; epic linkage is stored on `issues.epic_key`.
- Epic metadata is persisted across:
  - `epic_groups`, `work_types` (lookup/reference data)
  - `epic_metadata` (success checklist by epic)
  - `epic_metadata_groups`, `epic_metadata_work_types` (many-to-many mapping)
- Intended for local desktop runtime and frontend proxy usage.
