# TeamBeacon Product Specification (SPEC)

## 1. Purpose
TeamBeacon is a desktop-first engineering management app that aggregates delivery and operations data from hosted JIRA and Confluence (via PAT-authenticated APIs). It provides initiative, team, and individual insights, plus executive reporting.

## 2. Primary User
- Software Engineering Manager leading 9-11 engineers across multiple initiatives/services.
- Needs visibility into delivery health, sprint outcomes, operational load, and progress reporting.

## 3. Goals
- Centralize initiative and sprint performance views.
- Reduce manual reporting effort.
- Generate consistent RAG status and executive summaries.
- Enable configurable team- and project-specific definitions (custom fields, success criteria, aliases).

## 4. In Scope (MVP)
- Initiative insights (epic-centric):
  - Search/select epics via JQL.
  - Configure initiative success criteria (target completion, due date, blockers, scope change thresholds).
  - Generate RAG status and explanation.
- Team insights:
  - Sprint committed vs completed story points.
  - Average cycle time and trend.
  - Custom JIRA field mapping.
- Individual insights:
  - Team member aliasing (for example `SE 1`, `SE 2`, `QA 1`).
  - Work activity by configurable time window.
- Completed/In-progress work:
  - Current sprint board-style snapshot (`Done`, `In Progress`, `Planned`).
- Executive report:
  - Summary since last report.
  - Initiative-level progress and risks.
- UX mockups:
  - Maintain mockup coverage for six core screens in `docs/design/teambeacon-mockups.html`.

## 5. Out of Scope (MVP)
- Two-way updates to JIRA/Confluence.
- HR/performance evaluation workflows.
- Real-time push updates (poll/scheduled sync only).

## 6. Functional Requirements
1. Securely store and use JIRA/Confluence PAT tokens.
2. Allow source configuration (base URLs, projects, boards, query presets).
3. Run scheduled and manual sync with incremental fetch.
4. Persist normalized local analytics data.
5. Compute configurable metrics and RAG statuses.
6. Generate exportable executive report (Markdown/PDF-ready format).

## 6.1 JIRA Sync Semantics (Current Behavior)
- Sync modes:
  - `full`: fetch full board issue dataset.
  - `since_last`: incremental sync from last cursor.
- Incremental cursor logic:
  - Primary cursor = `sync_checkpoints.last_synced_at` for current board scope.
  - Fallback cursor = latest completed sync run `finished_at` for that board.
  - Effective cursor = selected cursor minus 2-day overlap (to avoid missed late updates or clock skew).
  - If no valid cursor exists, `since_last` automatically falls back to `full`.
- Incremental JQL pattern:
  - `project = <JIRA_PROJECT_KEY> AND updated >= '<UTC timestamp>' ORDER BY updated ASC`
- Per-run sync order:
  1. Board metadata
  2. Board sprints
  3. Issues (paged)
  4. Full changelog per downloaded issue
- Persistence guarantees:
  - `issues` stores issue type (including epics), epic link, parent issue link, assignee/reporter, sprint, and timestamps.
  - `issue_changelog` stores per-change author, field, before/after values, and change time.
  - `sync_run_history` stores run mode/status and counters.
  - `sync_checkpoints` stores latest successful cursor/timestamp.
- User-level attribution rule:
  - “Worked by user X” matches issue assignee, reporter, or any changelog author on that issue.

## 7. Non-Functional Requirements
- Local-first privacy model with least-privilege access.
- Resilient sync with retry/backoff and clear error states.
- Usable on macOS/Windows for desktop users.
- Fast dashboard loads from local cache.

## 8. Success Metrics
- <10 minutes to configure a new initiative.
- >80% reduction in manual weekly status compilation time.
- Weekly report generation in under 60 seconds after sync.

## 9. Suggested Repository Structure
```text
TeamBeacon/
  app/                     # Desktop UI (Tauri + React)
  services/api/            # FastAPI backend for sync + analytics
  services/workers/        # Scheduled jobs/sync processors
  packages/connectors/     # JIRA + Confluence API clients
  packages/metrics/        # RAG and performance calculations
  packages/reporting/      # Executive report generation
  docs/
    architecture/
    design/
    plans/
  infra/                   # Local/dev deployment and secrets templates
  tests/                   # Integration and end-to-end tests
```

## 10. Design Artifacts
- Primary UX reference: `docs/design/teambeacon-mockups.html`
- Supporting notes: `docs/design/README.md`
- Mockups must reflect:
  - Integrations & field mapping
  - Initiative insights
  - Team insights
  - Individual insights
  - Current sprint work
  - Executive report
