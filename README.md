# TeamBeacon

TeamBeacon is a desktop engineering insights app that aggregates data from multiple sources to track initiative health, team performance, and executive reporting.

## Current Status
- Product scope: [SPEC.md](SPEC.md)
- Architecture baseline: [docs/architecture/ARCHITECTURE.md](docs/architecture/ARCHITECTURE.md)
- Delivery plan: [docs/plans/PLAN.md](docs/plans/PLAN.md)
- UI mockups: [docs/design/teambeacon-mockups.html](docs/design/teambeacon-mockups.html)
- Initial DB migration and connector stubs are in place.
- React + Vite UI shell and Tauri desktop wrapper are scaffolded in `app/`.
- Oracle JET migration workspace is scaffolded in `app-ojet/` with live Integrations connectivity checks.

## Repository Layout
```text
TeamBeacon/
  app/                       # React + Vite UI shell
  app-ojet/                  # Oracle JET migration workspace (vDOM)
  services/
    api/db/migrations/
    workers/
  packages/
    connectors/
    metrics/
    reporting/
  docs/
    architecture/
    design/
    plans/
  infra/
  tests/
```

## Quick Start (Current Baseline)
1. Copy configuration template (or use existing `config/.env`):
```bash
cp config/.env.example config/.env
```
For OCI GenAI features, also install OCI SDK:
```bash
python3 -m pip install oci
```
2. Start UI shell (optional):
```bash
cd app
npm install
npm run dev
```
`npm run dev` starts both UI and local API together.
3. Start desktop shell (requires Rust toolchain):
```bash
cd app
npm run desktop:dev
```
`desktop:dev` auto-loads `~/.cargo/env` when available.
4. Apply the local schema:
```bash
sqlite3 teambeacon.db < services/api/db/migrations/0001_initial.sql
```
5. Validate connector module syntax:
```bash
PYTHONPYCACHEPREFIX=/tmp/pycache python3 -m py_compile packages/connectors/*.py
```
6. Run unit tests:
```bash
python3 -m unittest discover -s tests/unit -p "test_*.py" -v
```
7. Run API integration tests:
```bash
python3 -m unittest discover -s tests/integration/api -p "test_*.py" -v
```
8. (Optional) Run live JIRA integration tests:
```bash
RUN_LIVE_JIRA_TESTS=1 python3 -m unittest discover -s tests/integration -p "test_*.py" -v
```
9. Review contribution rules:
```bash
cat AGENTS.md
```
10. Open UI mockups:
```bash
open docs/design/teambeacon-mockups.html
```

## OJET Migration Workspace (In Progress)
Use this to continue frontend migration from React to Oracle JET:

1. Ensure backend API is running on `127.0.0.1:8000`:
```bash
cd app
npm run api:dev
```
2. Build OJET app:
```bash
cd app-ojet
npm install
npm run build
```
3. Serve OJET app on `http://127.0.0.1:5174`:
```bash
cd app-ojet
npm run dev
```

Current migrated slice in `app-ojet`:
1. TeamBeacon OJET shell + navigation for all screens.
2. Integrations screen wired to:
   - `GET /api/integrations/jira/status`
   - `GET /api/integrations/oci-genai/status`
3. Team Insights and Individual Insights migrated in OJET baseline.
4. Current Sprint Work migrated with:
   - `GET /api/sprints/current`
   - `GET /api/sprints/current/work`
   - `GET /api/sprints/current/changes`
5. Initiative Insights migrated with:
   - `GET /api/metadata/epics/summary`
   - `GET /api/integrations/jira/status` (for epic browse links)
6. Security, Incident Response, and Releases migrated to OJET baseline screens.
7. Executive Report remains scaffolded as a migration placeholder.

## Planned Stack
- Desktop app: Tauri + React
- Local API and workers: FastAPI (Python)
- Storage: SQLite (MVP), with future path to Postgres
- Integrations: Hosted JIRA REST and Confluence REST

## Next Implementation Milestones
1. Bootstrap FastAPI service entrypoint and config.
2. Expand JIRA connector usage in workers (issues, sprints, changelog ingestion pipeline).
3. Add initiative/team dashboard APIs backed by `metric_snapshots`.
4. Generate first executive report from local data snapshots.

## CI Pipeline
- GitHub Actions workflow: `.github/workflows/ci.yml`
- Triggers:
  - Push to `main`
  - Pull request targeting `main`
  - Manual run (`workflow_dispatch`)
- Checks:
  - Backend unit tests: `python3 -m unittest discover -s tests/unit -p "test_*.py" -v`
  - Backend API integration tests: `python3 -m unittest discover -s tests/integration/api -p "test_*.py" -v`
  - Frontend build: `cd app && npm ci && npm run build`
  - OJET build + tests with coverage: `cd app-ojet && npm ci && npm run build && npm run test:coverage`

## Documentation Index
- [AGENTS.md](AGENTS.md): contributor conventions and repository map.
- [SPEC.md](SPEC.md): product requirements and scope boundaries.
- [docs/architecture/ARCHITECTURE.md](docs/architecture/ARCHITECTURE.md): technical architecture baseline.
- [docs/plans/PLAN.md](docs/plans/PLAN.md): phased delivery roadmap.
- [docs/design/README.md](docs/design/README.md): design artifact overview.
- [tests/README.md](tests/README.md): unit/integration test commands.
