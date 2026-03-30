# TeamBeacon

TeamBeacon is a desktop engineering insights app that aggregates data from multiple sources to track initiative health, team performance, and executive reporting.

## Current Status
- Product scope: [SPEC.md](SPEC.md)
- Architecture baseline: [docs/architecture/ARCHITECTURE.md](docs/architecture/ARCHITECTURE.md)
- Delivery plan: [docs/plans/PLAN.md](docs/plans/PLAN.md)
- UI mockups: [docs/design/teambeacon-mockups.html](docs/design/teambeacon-mockups.html)
- Initial DB migration and connector stubs are in place.
- React + Vite UI shell and Tauri desktop wrapper are scaffolded in `app/`.

## Repository Layout
```text
TeamBeacon/
  app/                       # React + Vite UI shell
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

## Documentation Index
- [AGENTS.md](AGENTS.md): contributor conventions and repository map.
- [SPEC.md](SPEC.md): product requirements and scope boundaries.
- [docs/architecture/ARCHITECTURE.md](docs/architecture/ARCHITECTURE.md): technical architecture baseline.
- [docs/plans/PLAN.md](docs/plans/PLAN.md): phased delivery roadmap.
- [docs/design/README.md](docs/design/README.md): design artifact overview.
- [tests/README.md](tests/README.md): unit/integration test commands.
