# TeamBeacon Architecture

## 1. Overview
TeamBeacon is a self-hosted web analytics system:
- Browser app for configuration, dashboards, and reports.
- Containerized API service for ingestion, normalization, metrics, reporting, and static frontend delivery.
- SQLite as the source of truth for synced and computed data.

## 2. High-Level Components
1. UI (`app/`)
- React 19 single-page frontend built with Vite and served by the API runtime in production.
- Screens: Team Dashboard, Initiative Deep Dive, Initiative Insights, Team Insights, Sprint Insights, Security, Incident Response, Releases, Team Report, Settings.
- The persistent application header owns source-connection health, JIRA sync controls/history, and diagnostics in an accessible side sheet; Settings remains focused on editable product metadata, with Initiative Metadata and Work Stream Epic Mapping tabs. The mapping inventory reads synced epics from the configured project with optional metadata, excluding Triad labels; a dedicated assignment-only batch endpoint validates expected assignments under a SQLite write transaction and preserves other metadata.
- Styling: Tailwind CSS foundation plus TeamBeacon component styles and Lucide icons.
- The production artifact remains `app/web`, preserving the container and Python static-serving contract.

2. API (`services/api/`)
- Python local HTTP service exposing internal endpoints, OpenAPI schema, and Swagger UI.
- Orchestrates sync, metric calculation, and report generation.

3. Shared packages
- `packages/connectors`: hosted JIRA/Confluence API adapters.

4. Data store
- SQLite for configs, raw snapshots, normalized entities, and generated reports.

## 3. External Integrations
- JIRA (hosted, non-cloud): `/rest/api/2`, `/rest/agile/1.0`
- Confluence (hosted, non-cloud): `/rest/api/content`
- AI providers (pluggable by `INTELLIGENCE_PROVIDER`):
  - OCI GenAI (OCI SDK-backed)
  - Ollama local API
  - OpenAI-compatible API
- Auth: PAT tokens supplied to the container through environment variables or mounted secret files.

## 4. Core Data Model
- `integration_config`: base URLs, auth mode, sync settings.
- `team_members`: real account + alias (`SE 1`, `QA 1`).
- `initiative_config`: epic keys, initiative rules/success criteria.
- `issues`, `issue_changelog`, `sprints`, `boards`.
- `jira_project_versions`, `issue_release_links`: normalized release records and linked release scope for Release Insights.
- `epic_groups`, `work_types`: reusable lookup/reference data.
- `epic_metadata` + mapping tables: per-epic success checklist and group/work-type assignments.
- `metric_snapshots`: time-windowed aggregates.
- `report_runs`: generated outputs and baseline references.

## 5. Data Flow
1. The deployment supplies integration credentials and provider configuration; users maintain epic metadata in Settings and inspect live integration health from the global header.
2. Users can start or inspect JIRA syncs from the global system-status sheet. API sync logic pulls incremental issue/sprint/content changes. An optional, off-by-default deletion-reconciliation setting also compares local project issues with a complete key-only JIRA snapshot so deleted source cards and their dependent rows are safely removed without slowing routine syncs.
3. API normalizes and stores data.
4. Metrics engine computes initiative/team/release KPIs (including initiative creation/completion flow, current WIP, sprint trend, release cycle-time, and readiness metrics).
5. UI reads snapshots and renders dashboards.
6. Reporting module compares current state with the report baseline and generates completed-work summaries directly from synced JIRA issues.

## 6. RAG Determination (Initiatives)
Composite score from configurable rules:
- Completion ratio vs planned trajectory.
- Overdue risk (due dates, unresolved blockers).
- Scope volatility (% scope growth in period).
- Delivery trend (recent throughput/cycle time).

Default thresholds:
- Green: score >= 80
- Amber: score 60-79
- Red: score < 60

## 7. Security and Reliability
- No plaintext PAT storage in repo or config files.
- Encrypt sensitive local config where possible.
- Retry/backoff with rate-limit handling for Atlassian APIs.
- Audit log for sync errors and report generation events.

## 8. Deployment Model
- Single-container, single-user deployment for MVP.
- The Python runtime serves both `/api/*` endpoints and the compiled SPA from one origin.
- Future-ready for shared service mode (Postgres + hosted API) with same domain model.
- Codex dashboard integration: `services/mcp/` provides an optional Python stdio adapter calling the running API. Two read tools expose dashboard facts and a bundled React MCP Apps widget. The widget uses the host bridge. See [setup](../../services/mcp/README.md) and the [roadmap](../plans/MCP_INTEGRATION_PLAN.md). Native Codex rendering remains a client compatibility check.
- Analytics cache freshness reads the JIRA checkpoint without invoking sync-run recovery; operational status endpoints retain existing recovery behavior.

## 9. UI Information Architecture
- Primary navigation:
  - Team Dashboard
  - Initiative Insights
  - Initiative Deep Dive
  - Sprint Insights
  - Team Insights
  - Security
  - Incident Response
  - Releases
  - Team Report
  - Settings
- Interaction pattern:
  - `PrimaryNavigation` renders an 88-pixel left rail with icons and short labels, with hamburger-controlled expansion to a 288-pixel sidebar showing full names and descriptions. Settings remains at the bottom while the other destinations scroll on short screens; full-name tooltips support hover, focus and Escape dismissal.
  - Main pane for KPI cards, trend widgets, and narrative insights.
  - Team Dashboard is the startup destination and displays work-stream flow/progress through `GET /api/team/dashboard`. The web dashboard omits the release, sprint cycle-time, and blocker summary cards; the API retains these fields for compatibility.
  - Initiative Deep Dive defaults to all work streams, supports checkbox-based multi-work-stream selection, cascades the combined scope into an all-or-multi-epic selector, and applies one persisted preset-or-custom reporting period to its created/completed trend and activity table. The 1/2/4/12/26/52-week cards act as shared-period shortcuts.
  - Team Insights trend window is selectable (`1 sprint`, `Last 2/3/4/6/8/10/12 sprints`) and renders recent sprint first.
  - Release Insights renders release analytics: selectable cycle-time trend, ongoing readiness, overdue/due-soon counts, and risk signals.

## 10. Initiative Deep Dive Query Model
- `GET /api/initiative-deep-dive` owns the complete aggregation contract so weekly bars, period tiles, WIP counts, and table rows share one scope and timezone.
- Repeated `groupId` query parameters form a union of configured work-stream epics; shared epics and their cards are de-duplicated before metrics are calculated.
- The shared reporting period accepts either `chartWeeks` or an inclusive `chartStart`/`chartEnd` pair and drives both weekly buckets and activity rows. Custom boundaries remain exact and may yield partial first/last weekly buckets. The deprecated `tableWindowWeeks` parameter remains only as a compatibility override.
- Work-stream/epic membership and issue lineage are evaluated from the current local model; no historical work-stream-membership snapshots are implied.
- Creation and completion are dated events. In-progress is a current-state classification with the current run start derived from status changelog transitions.
- The query excludes epics/subtasks, reuses the current full-sync scope guard, and returns no more than 1,000 newest activity rows.
- Design source:
  - `docs/plans/FRONTEND_MODERNIZATION_PLAN.md` defines the active frontend direction and parity constraints.
  - Existing files under `docs/design/` remain historical references for screen inventory and prior visual exploration.

## 11. Team Dashboard Composition
- `GET /api/team/dashboard` is a read-only composite endpoint over existing local insight services; it does not introduce a second metric definition.
- The compact MCP widget displays work-stream progress, flow, filters, and freshness only; detailed highlights and issue lists remain available through the data tools and full web UI.
- Work-stream flow uses the same weekly created/completed semantics as Initiative Deep Dive, while progress uses completed cards divided by all currently scoped cards.
- Section failures are isolated and returned in an `errors` map so healthy dashboard regions remain usable.
- The frontend persists only the selected 1/4/12-week flow window; source data remains authoritative in SQLite.

### Project epic reconciliation
Each sync mode pages the eligible project epic search independently of the board issue API. Missing epics are backfilled regardless of the cursor; full sync refreshes every eligible epic, while incremental sync refreshes source changes. A shared connector scope rule excludes Triad labels and is also applied to the Settings mapping inventory. The existing board issue and child-issue sync paths continue to operate. No schema migration is required.

### Complete configured-epic analytics
Initiative Insights and Team Report explicitly request `limit=all` summaries; the API maps that to an unbounded configured-view query. Team Dashboard uses the same complete summary internally for work-stream epic counts and delivery progress. Explicit numeric API limits remain bounded for backward compatibility. Summary cache keys include the requested limit and selected view.

Initiative RAG requires an enabled timeline and valid target completion date. Unconfigured/incomplete timelines show neutral Not assessed, are excluded from color totals, and retain that status in Team Report exports and AI context. The start date remains optional.

Team Report stores initiative selection as a browser preference containing manual/automatic mode and ordered epic keys. Legacy key arrays parse as manual selections. The UI resolves automatic membership from existing reporting-period completion counts, retains valid custom order and preserves empty selections; no API/schema change is needed. Draft modal edits become active only on Save.

Team Report displays panels in this order on screen and in HTML exports: Report Signals, Work Mix by Work Stream and Type, Progress for Key Initiatives, Completed Work Summary. Executive Summary and Wins and Risks are removed from the screen and exports, including their AI requests and refresh controls; Completed Work Summary is generated programmatically from synced issue titles without AI requests.

Completed Work Summary is grouped by work stream, then epic. Each epic heading appears once as the title followed by its linked epic key in parentheses above its completed issue titles; each bullet shows the original issue title followed by its linked JIRA issue key in parentheses on the same line. Screen and HTML exports use the same layout and open JIRA links in new tabs. Titles and source metadata come directly from synced records without rewriting or clipping. Report and completed-card requests start together, completed cards are reused for selection changes within the same period, and Refresh reloads them. Report data comes only from the local SQLite database; no JIRA or AI health check is requested by Team Report. The summary response includes the locally configured JIRA base URL for links without testing connectivity or requiring credentials. Epic completion metrics are calculated in one issue scan for the selected epic set, preserving direct, parent and subtask membership and reporting-timezone semantics. Without a valid JIRA URL, source details remain visible as plain text.

Team Report work mix uses two equal donut-chart panels (Work Stream Mix and Work Type Mix), side by side on wide screens and stacked on narrow screens. Tables are removed; legends retain category names and percentages beside the original-style donuts, with no total or category counts and an explicit No data state for zero completions. HTML exports use the same chart layout.

Team Report initiative progress uses work-stream group headings and four columns: Initiative, Period progress, Overall completion and Timeline health. Compact rows show period progress on one line as completed/total cards (percentage). A dark column-header band is distinct from the light work-stream heading bands without a side accent. The subtitle reads “Delivery progress for initiatives included in this report.” Each work stream appears once, in first-seen order; initiatives retain their configured relative order within each group. Timeline health remains neutral for unassessed initiatives and exposes its explanation on hover or keyboard focus, dismissible with Escape. HTML exports retain grouped rows and progress labels.

Team Dashboard work-stream insights show Intake, throughput, and work mix. Share of completions is the stream’s completed cards divided by all completed cards in the selected flow period, shown with a neutral bar; totals show 100%, or a dash when no cards completed. The total row is labelled Total · All work streams, with no background fill, bold values, and a 3px neutral black-grey top border; metric status colours remain intact. Created/completed/share use the flow period; Current WIP is a snapshot and Net backlog change is created minus completed. Dashboard aggregation and drilldowns count each epic under its primary assignment (lowest group ID for legacy multi-assignments), with synthetic group ID 0 for Unmapped configured epics. Canonical issue ownership prevents double counting across legacy parent/epic links. The deep-dive API adds opt-in workStreamScope=primary; existing all-membership behavior and lifetime completion fields remain available for compatibility.

Team Dashboard Flow period supports Last week, Last 4 weeks, Last 12 weeks, and a saved Custom date range. A single date-range button opens presets and Custom in one dialog; Save applies the selection and Cancel preserves the active period. Custom reuses the Team Report Start/End fields with date-order validation. The dashboard API accepts optional inclusive `periodStart` and `periodEnd` dates (both required, at most 366 days, with future end dates allowed), includes them in its cache key, and reuses deep-dive date filtering for totals and card drilldowns. Switching to a preset clears the saved custom period.

The web dashboard distinguishes period-based flow from `WIP today`, labels card counts as `Cards Created` and `Cards Completed`, uses neutral card counts and signed backlog changes with explanations, and places counting rules under About these metrics. The table uses fluid column widths and switches to stacked rows on narrower screens to avoid horizontal scrolling. Count and backlog-change headers and values align centrally; inactive sort arrows appear on hover or keyboard focus. Source freshness is relative with the exact timestamp on hover. `Refresh view` reloads synced data without starting ingestion.

Team Dashboard shows Epic progress in the second-last column, after WIP today and before Share of completions: completed configured epics / all configured epics, shown as counts with aggregate totals. Completion uses the epic’s current JIRA Done status category (falling back to standard terminal status names only when category is absent), never child-card completion or an old resolution timestamp. This snapshot is independent of Flow period. Completed and total counts open completed-only or all-epic drilldowns under the same primary work-stream scope, including Unmapped. Unknown completion data displays Unavailable; zero-epic scopes show No epics. The API adds `completedEpicCount` to dashboard work streams and `isCompleted` to epic summaries/options; epic options also expose status. No schema migration is required.
