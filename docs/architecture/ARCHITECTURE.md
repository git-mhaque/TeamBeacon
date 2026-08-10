# TeamBeacon Architecture

## 1. Overview
TeamBeacon is a self-hosted web analytics system:
- Browser app for configuration, dashboards, and reports.
- Containerized API service for ingestion, normalization, metrics, reporting, and static frontend delivery.
- SQLite as the source of truth for synced and computed data.

## 2. High-Level Components
1. UI (`app/`)
- React 19 single-page frontend built with Vite and served by the API runtime in production.
- Screens: Settings, Initiative Insights, Initiative Deep Dive, Team Insights, Sprint Insights, Security, Incident Response, Releases, Team Dashboard.
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
1. User configures integrations, field mappings, epic metadata taxonomy, and active AI provider/model.
2. API sync logic pulls incremental issue/sprint/content changes.
3. API normalizes and stores data.
4. Metrics engine computes initiative/team/release KPIs (including initiative creation/completion flow, current WIP, sprint trend, release cycle-time, and readiness metrics).
5. UI reads snapshots and renders dashboards.
6. Reporting module compares current state with last report baseline and can generate AI-assisted narrative drafts.

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

## 9. UI Information Architecture
- Primary navigation:
  - Initiative Insights
  - Initiative Deep Dive
  - Sprint Insights
  - Team Insights
  - Security
  - Incident Response
  - Releases
  - Team Dashboard
  - Settings
- Interaction pattern:
  - Compact fixed left rail for screen navigation, with hamburger-controlled label expansion.
  - Main pane for KPI cards, trend widgets, and narrative insights.
  - Initiative Deep Dive defaults to all groups, supports checkbox-based multi-group selection, cascades the combined scope into an all-or-multi-epic selector, renders a 12-week created/completed chart, and drives table filtering from 1/2/4/12-week tiles.
  - Team Insights trend window is selectable (`1 sprint`, `Last 2/3/4/6/8/10/12 sprints`) and renders recent sprint first.
  - Release Insights renders release analytics: selectable cycle-time trend, ongoing readiness, overdue/due-soon counts, and risk signals.

## 10. Initiative Deep Dive Query Model
- `GET /api/initiative-deep-dive` owns the complete aggregation contract so weekly bars, period tiles, WIP counts, and table rows share one scope and timezone.
- Repeated `groupId` query parameters form a union of configured group epics; shared epics and their cards are de-duplicated before metrics are calculated.
- Group/epic membership and issue lineage are evaluated from the current local model; no historical group-membership snapshots are implied.
- Creation and completion are dated events. In-progress is a current-state classification with the current run start derived from status changelog transitions.
- The query excludes epics/subtasks, reuses the current full-sync scope guard, and returns no more than 1,000 newest activity rows.
- Design source:
  - `docs/plans/FRONTEND_MODERNIZATION_PLAN.md` defines the active frontend direction and parity constraints.
  - Existing files under `docs/design/` remain historical references for screen inventory and prior visual exploration.
