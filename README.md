# TeamBeacon

TeamBeacon is a desktop engineering insights app that aggregates delivery and operations data from hosted JIRA/Confluence and OCI GenAI-backed reporting workflows.

## Current Status
- Product scope: [SPEC.md](SPEC.md)
- Architecture baseline: [docs/architecture/ARCHITECTURE.md](docs/architecture/ARCHITECTURE.md)
- Delivery plan: [docs/plans/PLAN.md](docs/plans/PLAN.md)
- Documentation index: [docs/README.md](docs/README.md)
- Single frontend workspace: Oracle JET (vDOM) + Tauri in `app/`

## Repository Layout
```text
TeamBeacon/
  app/                       # Oracle JET frontend + Tauri desktop shell
  services/
    api/
    workers/
  packages/
    connectors/
    metrics/
    reporting/
  docs/
    architecture/
    design/
    plans/
    ops/
  infra/
  tests/
```

## Quick Start
1. Copy configuration template (or use existing `config/.env`):
```bash
cp config/.env.example config/.env
```
For OCI GenAI features, install OCI SDK:
```bash
python3 -m pip install oci
```
2. Start frontend + local API:
```bash
cd app
npm install
npm run dev
```
- Frontend: `http://127.0.0.1:5174`
- API: `http://127.0.0.1:8000`
3. Apply local schema (if needed):
```bash
sqlite3 teambeacon.db < services/api/db/migrations/0001_initial.sql
```
4. Run backend tests:
```bash
python3 -m unittest discover -s tests/unit -p "test_*.py" -v
python3 -m unittest discover -s tests/integration/api -p "test_*.py" -v
```
5. Run frontend checks:
```bash
cd app
npm run build
npm run test:coverage
```

## Desktop Shell (Tauri)
From `app/`:
```bash
npm run desktop:dev
npm run desktop:build
```

## CI Pipeline
- GitHub Actions workflow: `.github/workflows/ci.yml`
- Checks:
  - Backend unit tests
  - Backend API integration tests
  - Frontend (OJET) build + coverage tests: `cd app && npm ci && npm run build && npm run test:coverage`

## Documentation Index
- [AGENTS.md](AGENTS.md): contributor conventions and repository map
- [SPEC.md](SPEC.md): product requirements and scope boundaries
- [docs/architecture/ARCHITECTURE.md](docs/architecture/ARCHITECTURE.md): technical architecture baseline
- [docs/plans/PLAN.md](docs/plans/PLAN.md): phased delivery roadmap
- [docs/design/README.md](docs/design/README.md): design artifact overview
- [docs/ops/OCI_GENAI_CONNECTIVITY_SMOKE_TEST.md](docs/ops/OCI_GENAI_CONNECTIVITY_SMOKE_TEST.md): OCI GenAI smoke test
