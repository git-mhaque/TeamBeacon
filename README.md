# TeamBeacon

TeamBeacon is a local-first engineering intelligence app that sits on top of existing delivery data sources and helps Engineering Managers operate with clearer signals, lower cognitive load, and better delivery outcomes.

## 🎯 Overview
- Local-first workflow on the manager's machine.
- Non-destructive integration model (does not modify upstream source data).
- Metadata-driven insight layer (Group/Type/Epic configuration).
- AI-powered insights with pluggable provider support (OCI, Ollama, OpenAI).

## ✨ Core Capabilities
- Settings: source connectivity checks, sync controls, metadata configuration, and AI Model Connection status (provider + model).
- Initiative Insights: progress matrix, filters, and RAG visibility.
- Team Insights: sprint trend window controls (1/2/3/4/6/8/10/12), completed story points, and cycle-time trend metrics.
- Sprint Insights: state breakdown, work mix, scope-change and blocker visibility.
- Team Dashboard: AI-generated summary, wins/risks, initiative progress, and work-mix visibility for leadership updates.

## 📣 Communication One-Pager
For product messaging, capability narrative, and value framing, see:
- [TeamBeacon Communication One-Pager](docs/communication/communication_one_pager.md)

## 🖼️ Feature Preview
<table>
  <tr>
    <td align="center">
      <img src="docs/communication/images/settings-overview.png" alt="Settings overview" width="360" /><br />
      <sub>Settings Overview</sub>
    </td>
    <td align="center">
      <img src="docs/communication/images/initiative-insights.png" alt="Initiative insights" width="360" /><br />
      <sub>Initiative Insights</sub>
    </td>
  </tr>
  <tr>
    <td align="center">
      <img src="docs/communication/images/current-sprint-overview.png" alt="Sprint insights" width="360" /><br />
      <sub>Sprint Insights</sub>
    </td>
    <td align="center">
      <img src="docs/communication/images/executive-report-ready.png" alt="Team dashboard" width="360" /><br />
      <sub>Team Dashboard</sub>
    </td>
  </tr>
</table>

## 🧱 Repository Layout
```text
TeamBeacon/                  # Repository root
  app/                       # Oracle JET frontend + Tauri desktop shell
  services/                  # Runtime services
    api/                     # Local API endpoints and orchestration
  packages/                  # Shared Python packages
    connectors/              # Source connector configs and clients
  docs/                      # Product/architecture/design/ops/communication documentation
    communication/           # Communication one-pager and redacted screenshots
    architecture/            # Architecture reference docs
    design/                  # UI/UX mockups and design notes
    plans/                   # Delivery and implementation plans
    ops/                     # Operational runbooks
  tests/                     # Backend unit/integration test suites
```

## 🛠️ Prerequisites
- `git` for cloning and collaboration.
- `docker` (recommended for zero local npm/python setup).
- `python3` (3.11+ recommended) for API/runtime and backend tests.
- `node` and `npm` (Node 22 recommended, aligned with CI) for frontend build/test.
- `sqlite3` CLI (mandatory) for applying local schema migrations and ad-hoc DB checks.
- Rust toolchain (`rustup`, `cargo`, `rustc`) for Tauri desktop commands.
- Tauri CLI via cargo: `cargo install tauri-cli`
- OCI Python SDK (required only when `INTELLIGENCE_PROVIDER=oci`): `python3 -m pip install oci`
- Platform prerequisites for Tauri desktop builds (macOS): Xcode Command Line Tools (`xcode-select --install`)

## 🚀 Quick Start
1. Copy configuration template (or use existing `config/.env`):
```bash
cp config/.env.example config/.env
```
Configuration details are documented in [config/README.md](config/README.md).
By default this uses `TEAMBEACON_DB_PATH=data/teambeacon.db`.

2. Apply local database schema (mandatory before first run):
```bash
mkdir -p data
test -f data/teambeacon.db || sqlite3 data/teambeacon.db < services/api/db/migrations/0001_initial.sql
```

3. Start frontend + local API:
```bash
cd app
npm install
npm run dev
```
- Frontend: `http://localhost:5174`
- API: `http://localhost:8000`
- API Swagger UI: `http://localhost:8000/docs`
- API OpenAPI schema: `http://localhost:8000/openapi.json`

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

## 🐳 Docker Quick Start (No Local npm/Python Setup)
1. Copy configuration template:
```bash
cp config/.env.example config/.env
```

2. Start TeamBeacon using local image mode:
```bash
docker compose up -d --build

# Or choose a host port:
TEAMBEACON_HOST_PORT=19000 docker compose up -d --build
```
This builds from the local `Dockerfile` and starts `teambeacon` with Compose.

3. Open TeamBeacon:
- App + API: `http://localhost:18000`
- Swagger UI: `http://localhost:18000/docs`

4. Ollama in Docker:
- Keep `OLLAMA_BASE_URL` for local (non-Docker) development (`http://localhost:11434`).
- Use `OLLAMA_BASE_URL_DOCKER` for container runtime (set in `config/.env`).
- Docker default is `http://host.docker.internal:11434`; Rancher Desktop typically uses `http://host.rancher-desktop.internal:11434`.

5. OCI in Docker:
- Compose mounts `${HOME}/.oci` into the container at `/home/teambeacon/.oci` (read-only).
- Compose also mounts `${HOME}/.oci` at the same absolute host-style path inside the container (for configs that reference `/Users/<name>/.oci/...` directly).
- Default `OCI_GENAI_CONFIG_FILE` is `/home/teambeacon/.oci/config` in container mode.
- Ensure your `config/.env` includes `INTELLIGENCE_PROVIDER=oci` and required OCI variables.
- If your OCI config lives elsewhere, override with `OCI_GENAI_CONFIG_FILE=/path/in/container/config`.

## 🖥️ Desktop Shell (Tauri)
From `app/`:
```bash
npm run desktop:dev
npm run desktop:build
```

## ✅ CI Pipeline
- GitHub Actions workflow: `.github/workflows/ci.yml`
- Checks:
  - Backend unit tests
  - Backend API integration tests
  - Frontend (OJET) build + coverage tests: `cd app && npm ci && npm run build && npm run test:coverage`
  - Docker image build validation (local build only; no registry publish)

## 📚 Documentation
- [TeamBeacon Communication One-Pager](docs/communication/communication_one_pager.md): product narrative, value framing, and screenshots
- [AGENTS.md](AGENTS.md): contributor conventions and repository map
- [config/README.md](config/README.md): required and optional environment variables
- [services/api/README.md](services/api/README.md): local API endpoints and Swagger/OpenAPI docs
- [SPEC.md](SPEC.md): product requirements and scope boundaries
- [docs/architecture/ARCHITECTURE.md](docs/architecture/ARCHITECTURE.md): technical architecture baseline
- [docs/plans/PLAN.md](docs/plans/PLAN.md): phased delivery roadmap
- [docs/design/README.md](docs/design/README.md): design artifact overview
- [docs/ops/OCI_GENAI_CONNECTIVITY_SMOKE_TEST.md](docs/ops/OCI_GENAI_CONNECTIVITY_SMOKE_TEST.md): OCI-specific smoke test (use when `INTELLIGENCE_PROVIDER=oci`)
