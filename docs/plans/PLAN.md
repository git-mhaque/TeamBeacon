# TeamBeacon Delivery Plan

## 1. Delivery Strategy
Deliver in thin vertical slices: integrate data first, then insights, then executive reporting. Each phase ends with a usable demo and acceptance criteria.

## 2. Phase Plan (8 Weeks)

## Phase 0 (Week 1): Foundation
- Initialize repo structure and toolchain.
- Scaffold `app/` web frontend, `services/api/`, and shared packages.
- Define DB schema v1 and migrations.
- Implement secure secret handling via environment variables or mounted secret files.
- Establish baseline UI mockups for all MVP workflows.

Exit criteria:
- App launches locally.
- API and DB connected.
- PATs can be saved/read securely.
- Design mockups exist for all six MVP screens.

## Phase 1 (Weeks 2-3): JIRA + Confluence Ingestion
- Implement hosted JIRA connector (issues, epics, sprints, changelog).
- Implement Confluence connector for page retrieval by ID/URL.
- Add sync scheduler and incremental sync checkpointing.
- Build field mapping UI for custom JIRA fields.

Exit criteria:
- Data sync runs end-to-end with retry/error handling.
- Last-sync watermark works for incremental updates.

## Phase 2 (Weeks 4-5): Insights MVP
- Team Dashboard startup view focused on work-stream flow/progress and metric drilldowns; release, sprint cycle-time, and blocker summary cards are removed from the web dashboard.
- Initiative insights with configurable success criteria.
- Initiative Deep Dive with default-all and multi-group/epic cascading scope, weekly created/completed flow, selectable periods, current WIP, and card activity detail.
- Team metrics: committed/completed points, cycle time trends.
- Release metrics: release cycle time, selectable completed-release trend, ongoing release readiness, and linked scope risk.
- Individual insights by alias and date range.
- Sprint Insights snapshot (`Done`, `In Progress`, `Planned`).
- Align implemented UI routes/components with mockup intent.

Exit criteria:
- Dashboards render from local data without manual SQL.
- RAG calculation configurable per initiative.
- UX behavior is validated against design screens.

## Phase 3 (Weeks 6-7): Executive Reporting
- Generate source-linked completed-work summaries and initiative progress for the reporting period.
- Add report history and baseline comparison.
- Export in Markdown (PDF rendering optional stretch).

Exit criteria:
- One-click report generation works from UI.
- Report includes delivery signals, completed-work summaries, work mix, and initiative progress with timeline health.

## Phase 4 (Week 8): Hardening and Release
- Improve performance for large project datasets.
- Add integration and end-to-end tests for key user flows.
- Validate the labeled compact rail and expanded sidebar, including current-page state, keyboard/hover tooltips, construction markers, and navigation reachability on short screens.
- Prepare release packaging and onboarding docs.

Exit criteria:
- Stable container image and browser deployment.
- MVP release checklist completed.

## 3. Risks and Mitigations
- API field inconsistency across projects:
  - Mitigation: field mapping layer + validation checks.
- Ambiguous identity mapping for individuals:
  - Mitigation: explicit alias-to-account configuration.
- Reporting trust/adoption risk:
  - Mitigation: transparent metric formulas and drill-down links.

## 4. Immediate Next Tasks
Additional workstream: [Codex MCP integration](MCP_INTEGRATION_PLAN.md), with read-insights-only scope. Dashboard data/render tools, contextual resources and the React widget are implemented; native Codex rendering needs client verification. Broader read tools remain planned; sync and editing are optional future scope.

1. Complete the hardening gates in the [Frontend Modernization Plan](FRONTEND_MODERNIZATION_PLAN.md) while preserving the containerized Python API and SQLite runtime.
2. Create initial schema and migration scripts.
3. Implement JIRA smoke sync using a known project and board.
4. Add first dashboard: initiative list + RAG overview.
5. Harden Initiative Deep Dive with browser accessibility checks and production-container smoke coverage.
6. Add route-level code splitting and complete the remaining modernized-frontend hardening gates.

- MCP dashboard presentation simplified to work-stream progress, flow, filters, and freshness; removed metric cards and issue lists from the widget while retaining the data-tool contract.

### Bulk work stream epic mapping
- Delivered Settings tabs for Initiative Metadata and Work Stream Epic Mapping.
- Includes saved coverage/distribution, all synced epics, filters, sorting, 50-row pages, explicit bulk selection and draft save/discard.
- Assignment-only batches validate stale mappings and commit atomically, preserving other metadata and saved views. No schema or connector configuration change.

### Eligible project epic sync
- Added paginated project epic reconciliation to full, since-last, and since-date syncs, preserving the Test/Triad scope exclusions.
- Backfills old missing epics and preserves metadata and source watermarks; repeated incremental runs skip unchanged epics.
- Settings mapping inventory follows configured project and Triad exclusions.

### Complete configured-epic summaries
- Removed implicit 200-row truncation from Initiative Insights, Team Dashboard delivery progress and Team Report by explicitly requesting complete configured views.
- Preserved bounded numeric API requests and added >200-epic regression fixtures covering default/named views, completion metrics and work-stream totals.

Initiative RAG requires an enabled timeline and valid target completion date. Unconfigured/incomplete timelines show neutral Not assessed, are excluded from color totals, and retain that status in Team Report exports and AI context. The start date remains optional.

### Automatic Team Report initiative selection
- Added opt-in period-completion selection, saved mode/order, qualifying-count preview and manual overrides.
- Preserved legacy preferences and explicit empty selections; automatic selection recalculates after period changes while keeping reordered qualifying initiatives.

Team Report displays panels in this order on screen and in HTML exports: Report Signals, Work Mix by Work Stream and Type, Progress for Key Initiatives, Completed Work Summary. Executive Summary and Wins and Risks are removed from the screen and exports, including their AI requests and refresh controls; Completed Work Summary is generated programmatically from synced issue titles without AI requests.

Completed Work Summary is grouped by work stream, then epic. Each epic heading appears once as the title followed by its linked epic key in parentheses above its completed issue titles; each bullet shows the original issue title followed by its linked JIRA issue key in parentheses on the same line. Screen and HTML exports use the same layout and open JIRA links in new tabs. Titles and source metadata come directly from synced records without rewriting or clipping. Report and completed-card requests start together, completed cards are reused for selection changes within the same period, and Refresh reloads them. Report data comes only from the local SQLite database; no JIRA or AI health check is requested by Team Report. The summary response includes the locally configured JIRA base URL for links without testing connectivity or requiring credentials. Epic completion metrics are calculated in one issue scan for the selected epic set, preserving direct, parent and subtask membership and reporting-timezone semantics. Without a valid JIRA URL, source details remain visible as plain text.

Team Report work mix uses two equal donut-chart panels (Work Stream Mix and Work Type Mix), side by side on wide screens and stacked on narrow screens. Tables are removed; legends retain category names and percentages beside the original-style donuts, with no total or category counts and an explicit No data state for zero completions. HTML exports use the same chart layout.

Team Report initiative progress uses work-stream group headings and four columns: Initiative, Period progress, Overall completion and Timeline health. Compact rows show period progress on one line as completed/total cards (percentage). A dark column-header band is distinct from the light work-stream heading bands without a side accent. The subtitle reads “Delivery progress for initiatives included in this report.” Each work stream appears once, in first-seen order; initiatives retain their configured relative order within each group. Timeline health remains neutral for unassessed initiatives and exposes its explanation on hover or keyboard focus, dismissible with Escape. HTML exports retain grouped rows and progress labels.

Team Dashboard work-stream insights show Intake, throughput, and work mix. Share of completions is the stream’s completed cards divided by all completed cards in the selected flow period, shown with a neutral bar; totals show 100%, or a dash when no cards completed. Created/completed/share use the flow period; Current WIP is a snapshot and Net backlog change is created minus completed. Dashboard aggregation and drilldowns count each epic under its primary assignment (lowest group ID for legacy multi-assignments), with synthetic group ID 0 for Unmapped configured epics. Canonical issue ownership prevents double counting across legacy parent/epic links. The deep-dive API adds opt-in workStreamScope=primary; existing all-membership behavior and lifetime completion fields remain available for compatibility.

Team Dashboard Flow period supports Last week, Last 4 weeks, Last 12 weeks, and a saved Custom date range. A single date-range button opens presets and Custom in one dialog; Save applies the selection and Cancel preserves the active period. Custom reuses the Team Report Start/End fields with date-order validation. The dashboard API accepts optional inclusive `periodStart` and `periodEnd` dates (both required, at most 366 days, with future end dates allowed), includes them in its cache key, and reuses deep-dive date filtering for totals and card drilldowns. Switching to a preset clears the saved custom period.

The web dashboard distinguishes period-based flow from `WIP today`, labels card counts as `Cards Created` and `Cards Completed`, uses neutral card counts and signed backlog changes with explanations, and places counting rules under About these metrics. Count and backlog-change headers and values align centrally; inactive sort arrows appear on hover or keyboard focus. Source freshness is relative with the exact timestamp on hover. `Refresh view` reloads synced data without starting ingestion.
