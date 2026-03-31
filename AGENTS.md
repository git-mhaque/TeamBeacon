# Repository Guidelines

## Repository Map
```text
TeamBeacon/
  AGENTS.md
  README.md
  SPEC.md
  app/                          # Desktop UI (Oracle JET + Tauri)
  docs/
    architecture/ARCHITECTURE.md
    design/teambeacon-ojet-mockups.html
    plans/PLAN.md
  infra/                        # Local/dev infra templates
  packages/
    connectors/                 # Source connectors (JIRA/Confluence)
    metrics/                    # KPI and RAG logic
    reporting/                  # Executive report generation
  services/
    api/
      db/
        migrations/0001_initial.sql
    workers/                    # Sync and background jobs
  tests/                        # Integration and E2E tests
```

## Project Structure & Module Organization
- `services/api` owns ingestion orchestration, persistence, and internal APIs.
- `services/workers` owns scheduled/manual sync jobs.
- `packages/connectors` defines interfaces and hosted Atlassian stubs.
- `docs/` is the source of truth for product scope, architecture, and plan.
- `app/` should stay UI-only; business logic belongs in services/packages.

## Build, Test, and Development Commands
Tooling is minimal right now. Use:
- `cp config/.env.example config/.env` to initialize local connector config.
- `cd app && npm run dev` to run OJET UI plus local API for integration endpoints.
- `cd app && npm run desktop:dev` to run the Tauri desktop shell (auto-loads `~/.cargo/env` if needed).
- `python3 -m services.api.server --host 127.0.0.1 --port 8000` to run API separately (optional).
- `sqlite3 teambeacon.db < services/api/db/migrations/0001_initial.sql` to initialize local DB schema.
- `PYTHONPYCACHEPREFIX=/tmp/pycache python3 -m py_compile packages/connectors/*.py` for connector syntax checks.
- `python3 -m unittest discover -s tests/unit -p "test_*.py" -v` for unit tests.
- `python3 -m unittest discover -s tests/integration/api -p "test_*.py" -v` for local API integration tests.
- `RUN_LIVE_JIRA_TESTS=1 python3 -m unittest discover -s tests/integration -p "test_*.py" -v` for live integration tests.
- `cd app && npm run build` for production build validation.
- `cd app && npm run test:coverage` for frontend coverage validation.
- `open docs/design/teambeacon-ojet-mockups.html` to review current UI/UX mockups.
- `git log --oneline -n 10` to review recent commit conventions.

When FastAPI/Tauri projects are bootstrapped, add runnable commands to `README.md` and keep this section updated.

## Coding Style & Naming Conventions
- Follow language defaults with consistent indentation.
- Python modules should use type hints and explicit dataclasses for data contracts.
- Use `camelCase` for JS/TS identifiers, `snake_case` for Python file/function names, `PascalCase` for classes/types.
- Keep connectors thin; map external payloads into normalized models early.

## Testing Guidelines
- Add/update tests with each feature; avoid large untested batches.
- Name tests by behavior (`test_incremental_sync_cursor.py`, `initiative-rag.spec.ts`).
- Cover at least one success path and one failure path per unit.
- Prioritize metric correctness and sync idempotency tests.
- Enforce `>=90%` coverage across touched modules using unit + integration tests. If coverage tooling is missing for a component, add it in the same change before merging.

## Commit & Pull Request Guidelines
Use Conventional Commits. Current history follows:
- `docs: ...`
- `chore: ...`
- `feat: ...`

Strict pre-commit quality gate:
- Run and pass unit and integration tests for impacted areas.
- Run and pass front-end tests for impacted UI workspaces (mandatory for UI changes).
- Keep combined test coverage for changed code at `90%+`.
- Run style/lint checks before commit. For current baseline run:
  - `cd app && npm run build && npm run test:coverage`
  - `PYTHONPYCACHEPREFIX=/tmp/pycache python3 -m py_compile packages/connectors/*.py services/api/*.py services/api/integrations/*.py`
- If new language/tooling is introduced, add and document an explicit lint command in `README.md` and enforce it in PR validation.

PRs should include:
- Brief problem/solution summary.
- Linked issue/task reference.
- Validation evidence (test output, migration checks, or screenshots).
- Notes on schema/config changes and backward compatibility impact.

## Documentation Maintenance
- Keep `SPEC.md`, `docs/architecture/ARCHITECTURE.md`, and `docs/plans/PLAN.md` aligned when scope changes.
- Update `docs/design/teambeacon-ojet-mockups.html` when UI flows materially change.
- Add links in `README.md` for any new top-level docs.
