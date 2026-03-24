# TeamBeaconV2

TeamBeaconV2 is a desktop-first engineering insights application for Software Engineering Managers. It aggregates data from hosted JIRA and Confluence (PAT-authenticated) to provide initiative progress, team trends, individual activity, and executive reporting.

## Current Status
- Product scope: [SPEC.md](SPEC.md)
- Architecture baseline: [docs/architecture/ARCHITECTURE.md](docs/architecture/ARCHITECTURE.md)
- Delivery plan: [docs/plans/PLAN.md](docs/plans/PLAN.md)
- Initial DB migration and connector stubs are in place.

## Repository Layout
```text
TeamBeaconV2/
  app/
  services/
    api/db/migrations/
    workers/
  packages/
    connectors/
    metrics/
    reporting/
  docs/
    architecture/
    plans/
  infra/
  tests/
```

## Quick Start (Current Baseline)
1. Apply the local schema:
```bash
sqlite3 teambeacon.db < services/api/db/migrations/0001_initial.sql
```
2. Validate Python connector stubs:
```bash
PYTHONPYCACHEPREFIX=/tmp/pycache python3 -m py_compile packages/connectors/*.py
```
3. Review contribution rules:
```bash
cat AGENTS.md
```

## Planned Stack
- Desktop app: Tauri + React
- Local API and workers: FastAPI (Python)
- Storage: SQLite (MVP), with future path to Postgres
- Integrations: Hosted JIRA REST and Confluence REST

## Next Implementation Milestones
1. Bootstrap FastAPI service entrypoint and config.
2. Implement real hosted JIRA sync (issues, sprints, changelog).
3. Add initiative/team dashboard APIs backed by `metric_snapshots`.
4. Generate first executive report from local data snapshots.

