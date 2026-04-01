# TeamBeacon Delivery Plan

## 1. Delivery Strategy
Deliver in thin vertical slices: integrate data first, then insights, then executive reporting. Each phase ends with a usable demo and acceptance criteria.

## 2. Phase Plan (8 Weeks)

## Phase 0 (Week 1): Foundation
- Initialize repo structure and toolchain.
- Scaffold `app/` (Oracle JET + Tauri), `services/api/`, and shared packages.
- Define DB schema v1 and migrations.
- Implement secure secret handling via OS keychain.
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
- Initiative insights with configurable success criteria.
- Team metrics: committed/completed points, cycle time trends.
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
- Prepare release packaging and onboarding docs.

Exit criteria:
- Stable desktop build for primary OS target.
- MVP release checklist completed.

## 3. Risks and Mitigations
- API field inconsistency across projects:
  - Mitigation: field mapping layer + validation checks.
- Ambiguous identity mapping for individuals:
  - Mitigation: explicit alias-to-account configuration.
- Reporting trust/adoption risk:
  - Mitigation: transparent metric formulas and drill-down links.

## 4. Immediate Next Tasks
1. Finalize OJET desktop stack hardening (`Oracle JET + Tauri + FastAPI + SQLite`).
2. Create initial schema and migration scripts.
3. Implement JIRA smoke sync using a known project and board.
4. Add first dashboard: initiative list + RAG overview.
5. Keep `docs/design/teambeacon-ojet-mockups.html` aligned with implemented app screens.
