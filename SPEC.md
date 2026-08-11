# TeamBeacon Product Specification (SPEC)

## 1. Purpose
TeamBeacon is a self-hosted engineering management web app that aggregates delivery and operations data from hosted JIRA and Confluence (via PAT-authenticated APIs). It provides initiative, team, and individual insights, plus executive reporting.

## 2. Primary User
- Software Engineering Manager leading 9-11 engineers across multiple initiatives/services.
- Needs visibility into delivery health, sprint outcomes, operational load, and progress reporting.

## 3. Goals
- Centralize initiative and sprint performance views.
- Reduce manual reporting effort.
- Generate consistent RAG status and executive summaries.
- Enable configurable team- and project-specific definitions (custom fields, success criteria, aliases).
- Support pluggable AI providers for intelligence workflows (`oci`, `ollama`, `openai`).

## 4. In Scope (MVP)
- Team Dashboard:
  - Open as the default startup screen and summarize the most actionable delivery signals.
  - Show one card per work stream with selectable 1/4/12-week created-versus-completed flow, current WIP, and all-scope completion progress.
  - Show the latest completed release and cycle time, latest completed-sprint average cycle time compared with the previous completed sprint, current-sprint blockers, and cards completed in the last seven days.
  - Link summary cards to the relevant detailed insight screen.
- Initiative insights (epic-centric):
  - Search/select epics via JQL.
  - Configure initiative success criteria (target completion, due date, blockers, scope change thresholds).
  - Configure epic metadata:
    - success criteria checklist
    - one work stream
    - one work type
  - Generate RAG status and explanation.
- Initiative Deep Dive:
  - Start with all work streams selected, or select one or more work streams, then choose all or one or more configured epics across those work streams.
  - Compare new and completed card counts in weekly buckets over one persisted preset or custom reporting period, defaulting to 12 weeks.
  - Select a 1/2/4/12/26/52-week shortcut to apply that reporting period to both the chart and work-item activity table.
  - Inspect new, currently in-progress, and completed cards with newest qualifying activity first.
- Team insights:
  - Sprint trend window controls (`Last 4/6/8/10/12 sprints`).
  - Completed story points by sprint.
  - Average cycle time by sprint plus aggregate cycle-time cards (median/avg/max).
  - Sprint rows shown recent-to-old.
  - Custom JIRA field mapping.
- Release insights:
  - Sync release records and linked release scope from the configured delivery source.
  - Show release cycle-time trend from start date to release date.
  - Allow users to choose which completed releases appear in the trend, ordered oldest to newest.
  - Show ongoing release readiness, overdue/due-soon counts, delivered scope, completion quality, and risk signals.
- Completed/In-progress work:
  - Sprint Insights board-style snapshot (`Done`, `In Progress`, `Planned`) with state breakdown and work mix breakdown.
- Team Report:
  - Summary since last report.
  - Initiative-level progress and risks.
  - AI draft generation using selected provider/model from Settings.
- UX mockups:
  - Maintain design documentation for current screens and preserve functional parity during frontend modernization.

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
7. Configure and persist initiative metadata lookups (`work streams`, `work types`) and per-epic assignments.
8. Support runtime AI provider selection via `INTELLIGENCE_PROVIDER` with provider-specific configuration.
9. Provide work-stream- and epic-scoped initiative flow analytics for created, in-progress, and completed Jira cards.

## 6.1 JIRA Sync Semantics (Current Behavior)
- Sync modes:
  - `full`: fetch full board issue dataset.
  - `since_last`: incremental sync from last cursor.
  - `since_date`: incremental sync from a user-specified past date.
- Incremental cursor logic:
  - Primary cursor = `sync_checkpoints.last_synced_at` for current board scope.
  - Fallback cursor = latest completed sync run `finished_at` for that board.
  - Effective cursor = selected cursor as-is (no overlap).
  - If no valid cursor exists, `since_last` automatically falls back to `full`.
  - For `since_date`, cursor is the provided date at `00:00:00Z` (or provided ISO-8601 timestamp) and must be in the past.
- Incremental JQL pattern:
  - `project = <JIRA_PROJECT_KEY> AND updated >= '<UTC timestamp>' ORDER BY updated ASC`
- Deletion reconciliation:
  - A per-run “Remove cards deleted from JIRA” option is available and is off by default so routine incremental syncs remain fast.
  - When selected, sync fetches a lightweight, paginated snapshot of all current issue keys in the configured JIRA project.
  - Locally stored project issues absent from that complete snapshot are removed with their changelog and release-link rows.
  - Snapshot failures fail the sync and preserve all local issues; partial or transient responses never trigger deletion.
- Per-run sync order:
  1. Board metadata
  2. Project release records
  3. Board sprints
  4. Issues (paged)
  5. Full changelog per downloaded issue
- Persistence guarantees:
  - `issues` stores issue type (including epics), epic link, parent issue link, assignee/reporter, sprint, and timestamps.
  - `jira_project_versions` stores normalized project release records.
  - `issue_release_links` stores issue-to-release scope links normalized from source release fields.
  - `issue_changelog` stores per-change author, field, before/after values, and change time.
  - `sync_run_history` stores run mode/status and counters.
  - `sync_checkpoints` stores latest successful cursor/timestamp.
  - Successful deletion reconciliation never moves the incremental source cursor backwards.
- User-level attribution rule:
  - “Worked by user X” matches issue assignee, reporter, or any changelog author on that issue.

## 6.2 Initiative Metadata Configuration (Current Behavior)
- Epic metadata is managed from Initiative Insights (Configure/Edit Epic flow).
- Lookup/reference data:
  - `work streams` can be added and reused.
  - `work types` can be added and reused.
- Per-epic configuration payload:
  - `epicKey`
  - `successCriteria[]`
  - `timelineEnabled` (boolean)
  - `timelineStartDate` (optional ISO date)
  - `targetCompletionDate` (ISO date, required when `timelineEnabled=true`)
  - `groupIds[]` (at most one value)
  - `workTypeIds[]` (at most one value)
- Persisted storage:
  - `epic_groups`
  - `work_types`
  - `epic_metadata`
  - `epic_metadata_groups`
  - `epic_metadata_work_types`

## 6.3 Team Insights Semantics (Current Behavior)
- Trend window:
  - API accepts `sprintLimit` in range 1-12.
  - UI offers `4, 6, 8, 10, 12` and defaults to `6`.
- Sprint trend ordering:
  - Backend trend data is oldest->newest.
  - UI renders recent sprint first for readability.
- Cycle-time calculation:
  - Start at the first changelog transition into an in-progress state.
  - End at issue resolved timestamp.
  - Include only completed cards.
  - Exclude `Epic` issue type from cycle-time metrics.
- Status-level cycle-time visibility:
  - Track per-status dwell time across completed cards in the selected sprint window.
  - Surface per-status aggregate metrics (`avg`, `median`, `p85`, `max`, total share).

## 6.4 Initiative Deep Dive Semantics
- Scope:
  - At least one `groupId` is required; repeated `groupId` values combine groups and shared epics are de-duplicated.
  - Omitting `epicKey` means all configured epics across the selected work streams; repeated `epicKey` values select a subset.
  - Epics and subtasks are excluded from card metrics.
  - Direct epic children and one-level nested children are included using current Jira lineage.
- Weekly flow:
  - Weeks start Monday in the requested IANA timezone and include the current partial week.
  - `New` counts distinct cards by Jira creation timestamp.
  - `Completed` counts currently done cards once, using their latest resolution timestamp.
  - A card created and completed in the same week contributes once to both series.
  - Reopened cards that remain open are not counted as completed; re-completed cards use their latest completion.
- Reporting period, shortcuts, and activity table:
  - One persisted reporting period drives both the chart and activity table. It offers 1/2/4/8/12/26/52-week presets plus an inclusive custom date range; 12 weeks is the default. Custom boundaries can create partial first or last buckets.
  - The 1/2/4/12/26/52-week cards remain visible as comparative summaries and quick shortcuts. Selecting one changes the shared reporting period.
  - `New` matches cards created in the period.
  - `In Progress` matches cards currently in the Jira `In Progress` category whose current in-progress run began in the period.
  - `Completed` matches cards completed in the period.
  - `Current WIP` is a separate all-age snapshot so ageing active work is not hidden by the selected period.
  - The combined activity table deduplicates cards that match multiple event types and sorts by latest qualifying activity.

## 7. Non-Functional Requirements
- Local-first privacy model with least-privilege access.
- Resilient sync with retry/backoff and clear error states.
- Usable in modern browsers on macOS and Windows.
- Fast dashboard loads from local cache.

## 8. Success Metrics
- <10 minutes to configure a new initiative.
- >80% reduction in manual weekly status compilation time.
- Weekly report generation in under 60 seconds after sync.

## 9. Suggested Repository Structure
```text
TeamBeacon/
  app/                     # Web UI (React + Vite)
  services/api/            # Python local API service for sync + analytics
  packages/connectors/     # JIRA + Confluence API clients
  docs/
    architecture/
    design/
    plans/
  tests/                   # Integration and end-to-end tests
```

## 10. Design Artifacts
- Primary frontend direction: `docs/plans/FRONTEND_MODERNIZATION_PLAN.md`
- Historical UX references: `docs/design/teambeacon-ojet-mockups.html` and `docs/design/redwood-ojet-dashboard.html`
- Supporting notes: `docs/design/README.md`
- Mockups must reflect:
  - Global system status (source connections, JIRA sync, history, and diagnostics)
  - Team Dashboard
  - Settings (epic metadata)
  - Initiative insights
  - Initiative Deep Dive
  - Team insights
  - Sprint Insights
  - Security / Incident response / Releases
  - Team Report
