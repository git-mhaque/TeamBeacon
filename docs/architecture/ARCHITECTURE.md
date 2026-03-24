# TeamBeacon Architecture

## 1. Overview
TeamBeacon is a local-first desktop analytics system:
- Desktop app for configuration, dashboards, and reports.
- Local API service for ingestion, normalization, metrics, and reporting.
- SQLite as the source of truth for synced and computed data.

## 2. High-Level Components
1. UI (`app/`)
- Tauri + React frontend.
- Screens: Integrations, Initiatives, Team Insights, Individuals, Current Sprint, Reports.
- UX reference: `docs/design/teambeacon-mockups.html`

2. API (`services/api/`)
- FastAPI service exposing internal endpoints for UI.
- Orchestrates sync, metric calculation, and report generation.

3. Workers (`services/workers/`)
- Scheduled/manual jobs:
  - JIRA incremental sync.
  - Confluence page fetch for context/initiative notes.
  - Metric snapshot generation.

4. Shared packages
- `packages/connectors`: hosted JIRA/Confluence API adapters.
- `packages/metrics`: cycle time, velocity, RAG logic.
- `packages/reporting`: executive narrative + export formatting.

5. Data store
- SQLite for configs, raw snapshots, normalized entities, and generated reports.

## 3. External Integrations
- JIRA (hosted, non-cloud): `/rest/api/2`, `/rest/agile/1.0`
- Confluence (hosted, non-cloud): `/rest/api/content`
- Auth: PAT tokens, stored in OS keychain; app references keychain entries only.

## 4. Core Data Model
- `integration_config`: base URLs, auth mode, sync settings.
- `team_members`: real account + alias (`SE 1`, `QA 1`).
- `initiative_config`: epic keys, initiative rules/success criteria.
- `issues`, `issue_changelog`, `sprints`, `boards`.
- `metric_snapshots`: time-windowed aggregates.
- `report_runs`: generated outputs and baseline references.

## 5. Data Flow
1. User configures integrations and field mappings.
2. Worker pulls incremental issue/sprint/content changes.
3. API normalizes and stores data.
4. Metrics engine computes initiative/team/individual KPIs.
5. UI reads snapshots and renders dashboards.
6. Reporting module compares current state with last report baseline.

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
- Single-user local deployment for MVP.
- Future-ready for shared service mode (Postgres + hosted API) with same domain model.

## 9. UI Information Architecture
- Primary navigation:
  - Integrations & Field Mapping
  - Initiative Insights
  - Team Insights
  - Individual Insights
  - Current Sprint Work
  - Executive Report
- Interaction pattern:
  - Left rail for filters/context scope.
  - Main pane for KPI cards, trend widgets, and narrative insights.
- Design source:
  - `docs/design/teambeacon-mockups.html` should be updated with major flow changes.
