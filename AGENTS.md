# Repository Guidelines

## Project Structure & Module Organization
`TeamBeaconV2` is currently an empty scaffold (no committed source, tests, or tooling yet).  
When adding the first implementation, use this baseline layout:
- `src/` for application code, organized by feature/module.
- `tests/` for automated tests mirroring `src/` paths.
- `assets/` for static files (images, fixtures, sample data).
- `docs/` for architecture notes and decision records.

Keep modules small and cohesive. Prefer feature-first grouping (for example, `src/auth/`, `src/notifications/`) over large shared utility files.

## Build, Test, and Development Commands
No build/test runner is configured yet. After initializing tooling, expose standard entry points so contributors can run:
- `npm run dev` (or equivalent): local development workflow.
- `npm test`: full automated test suite.
- `npm run lint`: static analysis and style checks.
- `npm run build`: production artifact build.

If you choose a non-Node stack, provide equivalent `make`/CLI commands and document them in `README.md`.

## Coding Style & Naming Conventions
Until language-specific tooling is added:
- Use 2- or 4-space indentation consistently per language default.
- Use `camelCase` for variables/functions, `PascalCase` for classes/types, and `kebab-case` for file names.
- Keep functions focused and side-effect boundaries explicit.

Add formatter/linter configs early (for example, Prettier + ESLint, or Black + Ruff) and run them before opening PRs.

## Testing Guidelines
Create tests alongside new code from the first feature onward.  
Conventions:
- Name tests after behavior (for example, `auth-login.test.ts`, `test_auth_login.py`).
- Include at least one happy-path and one failure-path test per unit.
- Target meaningful coverage on core logic before merging.

## Commit & Pull Request Guidelines
No Git history exists yet in this folder, so no native commit pattern can be inferred. Start with Conventional Commits:
- `feat: add login endpoint`
- `fix: handle token expiry`

PRs should include:
- Clear problem/solution summary.
- Linked issue/task ID (if available).
- Test evidence (command output or screenshots for UI/API behavior).
- Notes on config, migration, or breaking changes.
