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
- Team Dashboard startup snapshot with work-stream flow/progress, release and sprint-cycle highlights, current blockers, recent completions, and detail-screen drill-downs.
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
- Generate executive summary and initiative delta since last report.
- Add report history and baseline comparison.
- Export in Markdown (PDF rendering optional stretch).

Exit criteria:
- One-click report generation works from UI.
- Report includes progress, risks, and open concerns.

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

Team Report displays panels in this order on screen and in HTML exports: Report Signals, Completed Work Summary, Work Mix by Work Stream and Type, Progress for Key Initiatives, Wins and Risks, Executive Summary.

Completed Work Summary is grouped by work stream, then epic. Each linked epic title appears once above its outcome bullets; each bullet shows its linked issue key and original issue title on a smaller, muted second line. Screen and HTML exports use the same layout and open JIRA links in new tabs. Source metadata comes from synced records; AI bullets are matched by card ID, with original-outcome fallbacks for missing or invalid references. Without a valid JIRA URL, source details remain visible as plain text.

Team Report work mix uses two equal donut-chart panels (Work Stream Mix and Work Type Mix), side by side on wide screens and stacked on narrow screens. Tables are removed; legends retain category names and percentages beside the original-style donuts, with no total or category counts and an explicit No data state for zero completions. HTML exports use the same chart layout.
