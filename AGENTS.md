# Repository Guidelines

## Repository Map
```text
TeamBeaconV2/
  AGENTS.md
  README.md
  SPEC.md
  app/                          # Desktop UI (planned: Tauri + React)
  docs/
    architecture/ARCHITECTURE.md
    design/teambeacon-mockups.html
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
- `sqlite3 teambeacon.db < services/api/db/migrations/0001_initial.sql` to initialize local DB schema.
- `PYTHONPYCACHEPREFIX=/tmp/pycache python3 -m py_compile packages/connectors/*.py` for connector syntax checks.
- `open docs/design/teambeacon-mockups.html` to review current UI/UX mockups.
- `git log --oneline -n 10` to review recent commit conventions.

When FastAPI/Tauri projects are bootstrapped, add runnable commands to `README.md` and keep this section updated.

## Coding Style & Naming Conventions
- Follow language defaults with consistent indentation.
- Python modules should use type hints and explicit dataclasses for data contracts.
- Use `camelCase` for JS/TS identifiers, `snake_case` for Python file/function names, `PascalCase` for classes/types.
- Keep connectors thin; map external payloads into normalized models early.

## Testing Guidelines
- Add tests with each feature; avoid large untested batches.
- Name tests by behavior (`test_incremental_sync_cursor.py`, `initiative-rag.spec.ts`).
- Cover at least one success path and one failure path per unit.
- Prioritize metric correctness and sync idempotency tests.

## Commit & Pull Request Guidelines
Use Conventional Commits. Current history follows:
- `docs: ...`
- `chore: ...`
- `feat: ...`

PRs should include:
- Brief problem/solution summary.
- Linked issue/task reference.
- Validation evidence (test output, migration checks, or screenshots).
- Notes on schema/config changes and backward compatibility impact.

## Documentation Maintenance
- Keep `SPEC.md`, `docs/architecture/ARCHITECTURE.md`, and `docs/plans/PLAN.md` aligned when scope changes.
- Update `docs/design/teambeacon-mockups.html` when UI flows materially change.
- Add links in `README.md` for any new top-level docs.
