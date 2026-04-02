# TeamBeacon Local API

Lightweight local API endpoints used by the desktop/web shell.

## Run
From repository root:

```bash
python3 -m services.api.server --host 127.0.0.1 --port 8000
```

## Endpoints
- `GET /openapi.json`
  - Machine-readable OpenAPI schema for the local API.
- `GET /docs`
  - Interactive Swagger UI for exploring and trying endpoints.
  - Aliases: `/api/docs`, `/swagger`
- `GET /health`
- `GET /api/integrations/jira/status`
- `GET /api/integrations/jira/sync/status`
- `POST /api/integrations/jira/sync/start`
  - Optional JSON body:
    - `{"mode":"full"}`
    - `{"mode":"since_last"}`
    - `{"mode":"since_date","sinceDate":"2026-03-01"}`
- `GET /api/integrations/jira/sync/history?limit=30`
- `GET /api/integrations/confluence/status`
  - Validates Confluence REST reachability with PAT/basic auth:
    - `/rest/api/space?limit=1` query
    - Required Confluence environment variables
- `GET /api/integrations/oci-genai/status`
  - Validates local OCI GenAI wiring:
    - OCI SDK availability
    - `~/.oci/config` profile readability
    - Required OCI GenAI environment variables
- `POST /api/ai/chat`
  - Body:
    - `message` (required string)
    - `modelId` (optional string; defaults from `OCI_GENAI_MODEL_ID`)
    - `maxTokens` (optional integer)
    - `temperature` (optional number)
    - `topP` (optional number)
    - `topK` (optional integer)
    - `frequencyPenalty` (optional number)
- `GET /api/issues/search`
  - Optional query params:
    - `epicKey=CEGBUPOL-4482`
    - `workedBy=user-qa` (matches assignee/reporter/changelog contributor)
    - `assignee=<accountId>`, `reporter=<accountId>`
    - `issueType=Story`, `status=In Progress`
    - `updatedSince=2026-03-01T00:00:00+00:00`, `updatedUntil=2026-03-31T23:59:59+00:00`
    - `limit=100` (1-500)
- `GET /api/sprints/current`
  - Returns active sprint metadata from local synced data:
    - `name`, `startDate`, `endDate`, `remainingDays`
- `GET /api/sprints/current/work`
  - Returns active sprint work buckets:
    - `done`, `inProgress`, `planned`
    - Includes `totals` per bucket and aggregate `total`
- `GET /api/metadata/lookup`
  - Returns lookup/reference data:
    - `groups` (epic groups)
    - `workTypes` (work-type taxonomy)
- `POST /api/metadata/lookup/groups`
  - Body: `{"name":"Platform"}`
- `POST /api/metadata/lookup/groups/update`
  - Body: `{"id":1,"name":"Platform Core"}`
- `POST /api/metadata/lookup/groups/delete`
  - Body: `{"id":1}`
- `POST /api/metadata/lookup/work-types`
  - Body: `{"name":"Feature"}`
- `POST /api/metadata/lookup/work-types/update`
  - Body: `{"id":10,"name":"Run"}`
- `POST /api/metadata/lookup/work-types/delete`
  - Body: `{"id":10}`
- `GET /api/metadata/epics?limit=50`
  - Optional query param: `epicKey=CEGBUPOL-4482`
- `GET /api/metadata/epics/summary?limit=50`
  - Returns configured epics with completion metrics derived from local synced issue cards.
  - Optional query params:
    - `periodStart=2026-03-01`
    - `periodEnd=2026-03-31`
    - `timezone=Australia/Melbourne` (IANA timezone; defaults to `UTC`)
  - Includes:
    - `completedInPeriod` (items completed in inclusive reporting period)
    - `deltaPercentInPeriod` (`completedInPeriod / totalCards * 100`)
    - Backward-compatible aliases:
      - `completedLastWeek` -> `completedInPeriod`
      - `deltaPercent` -> `deltaPercentInPeriod`
    - `reportingPeriod`:
      - `startDate`, `endDate`, `days`, `timezone`
- `GET /api/metadata/epics/candidates?q=<key-or-name>&limit=20`
  - Returns unconfigured epic candidates from local synced `issues` (issue type `Epic`).
- `POST /api/metadata/epics`
  - Body:
    - `epicKey` (required)
    - `successCriteria` (string array)
    - `groupIds` (int array)
    - `workTypeIds` (int array)
- `POST /api/metadata/epics/delete`
  - Body:
    - `epicKey` (required)

## Notes
- The JIRA status endpoint reads `config/.env` (or process env vars).
- The Confluence status endpoint reads `config/.env` (or process env vars).
- OCI GenAI endpoints read `config/.env` (or process env vars) and require the OCI Python SDK (`python3 -m pip install oci`).
- JIRA sync persists board/sprint/issue/changelog data to local SQLite (`teambeacon.db` by default).
- Parent-child lineage is stored on `issues.parent_issue_key`; epic linkage is stored on `issues.epic_key`.
- Epic metadata is persisted across:
  - `epic_groups`, `work_types` (lookup/reference data)
  - `epic_metadata` (success checklist by epic)
  - `epic_metadata_groups`, `epic_metadata_work_types` (many-to-many mapping)
- Intended for local desktop runtime and frontend proxy usage.
