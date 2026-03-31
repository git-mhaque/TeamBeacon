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
TeamBeacon/                  # Repository root
  app/                       # Oracle JET frontend + Tauri desktop shell
  services/                  # Runtime services
    api/                     # Local API endpoints and orchestration
  packages/                  # Shared Python packages
    connectors/              # Source connector configs and clients
  docs/                      # Product/architecture/design/ops documentation
    architecture/            # Architecture reference docs
    design/                  # UI/UX mockups and design notes
    plans/                   # Delivery and implementation plans
    ops/                     # Operational runbooks
  tests/                     # Backend unit/integration test suites
```

## Prerequisites
- `git` for cloning and collaboration.
- `python3` (3.11+ recommended) for API/runtime and backend tests.
- `node` and `npm` (Node 22 recommended, aligned with CI) for frontend build/test.
- `sqlite3` CLI for applying local schema migrations and ad-hoc DB checks.
- Rust toolchain (`rustup`, `cargo`, `rustc`) for Tauri desktop commands.
- Tauri CLI via cargo: `cargo install tauri-cli`
- OCI Python SDK (required only for OCI GenAI endpoints): `python3 -m pip install oci`
- Platform prerequisites for Tauri desktop builds (macOS): Xcode Command Line Tools (`xcode-select --install`)

## Quick Start
1. Copy configuration template (or use existing `config/.env`):
```bash
cp config/.env.example config/.env
```
Configuration details are documented in [config/README.md](config/README.md).

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
- [config/README.md](config/README.md): required and optional environment variables
- [SPEC.md](SPEC.md): product requirements and scope boundaries
- [docs/architecture/ARCHITECTURE.md](docs/architecture/ARCHITECTURE.md): technical architecture baseline
- [docs/plans/PLAN.md](docs/plans/PLAN.md): phased delivery roadmap
- [docs/design/README.md](docs/design/README.md): design artifact overview
- [docs/ops/OCI_GENAI_CONNECTIVITY_SMOKE_TEST.md](docs/ops/OCI_GENAI_CONNECTIVITY_SMOKE_TEST.md): OCI GenAI smoke test
