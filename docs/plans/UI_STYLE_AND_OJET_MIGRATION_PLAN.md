# TeamBeacon UI Style Analysis and OJET Migration Plan

Last updated: 2026-03-30

## Implementation Status (2026-03-30)
1. `app-ojet/` Oracle JET vDOM workspace has been scaffolded in-repo.
2. TeamBeacon app shell and screen navigation are implemented in OJET baseline.
3. Integrations screen is wired to live backend connectivity endpoints for JIRA and OCI GenAI.
4. Team Insights and Individual Insights are migrated into the OJET workspace.
5. Current Sprint Work is migrated with live sprint metadata, scope changes, and work columns.
6. Remaining screens are scaffolded as placeholders for phased migration.

## 1. Scope and Goal
This document captures:
1. UI analysis of all current TeamBeacon screens.
2. A pragmatic style enhancement plan for the existing React frontend.
3. A phased migration plan from the current frontend stack to Oracle JET (OJET).

The target is to improve consistency and usability now, while reducing migration risk and rework.

## 2. Current Frontend Baseline
### Stack
1. React 19 + TypeScript + Vite.
2. Tauri desktop shell.
3. No route-level framework; screen switching is local state in `App.tsx`.
4. API communication through typed fetch wrappers in `src/lib/api.ts`.

### Architecture Snapshot
1. App shell and screen navigation are centralized in `src/App.tsx`.
2. Most business logic is screen-local, especially in:
   1. `IntegrationsScreen.tsx`
   2. `InitiativesScreen.tsx`
   3. `ExecutiveReportScreen.tsx`
3. Styling is centralized in one large global stylesheet: `src/styles.css`.
4. Shared UI primitives are minimal: `Panel`, `MetricCard`, `StatusPill`, `InitiativeSummaryProgress`.

## 3. Screen-by-Screen UI Analysis
| Screen | Data status | UI strengths | UI issues | Migration complexity |
|---|---|---|---|---|
| Integrations & Field Mapping | Live API-backed | Rich operational controls (connection checks, sync modes, history, metadata CRUD) | Dense card content; action controls mixed into metric hints; custom modal/table patterns repeated | Medium |
| Initiative Insights | Live API-backed | Strong data table with filtering, sorting, metadata overlays | Very large component; duplicated interaction logic; custom dropdown/modal complexity; mixed summary + operations in one page | High |
| Team Insights | Placeholder/static | Clean card composition | Static-only content and no reusable data-state pattern | Low |
| Individual Insights | Placeholder/static | Clear structure and narrative flow | Static-only content and no drill-down behavior | Low |
| Current Sprint Work | Live API-backed | Useful board-style columns and metric overview | Repeated ticket card markup; custom columns not reused elsewhere | Medium |
| Security | Placeholder/static | Clear future intent and layout consistency | Placeholder-only behavior | Low |
| Incident Response | Placeholder/static | Clear future intent and layout consistency | Placeholder-only behavior | Low |
| Releases | Placeholder/static | Clear future intent and layout consistency | Placeholder-only behavior | Low |
| Executive Report | Live API + OCI GenAI-backed | Strong executive workflow (period selection, AI summary, wins/risks, distribution views) | Very high complexity; duplicated RAG/date logic with Initiatives; custom dialog and drag/reorder behavior | High |

## 4. Cross-Cutting UX and Code Findings
1. Information hierarchy drifts across dense screens, especially Integrations, Initiatives, and Executive.
2. Complex interactions (filters, dialogs, tables, reorder flows) are implemented ad hoc in screens.
3. Business logic duplication exists across screens:
   1. RAG evaluation and date utility functions are repeated in Initiatives and Executive.
4. Custom modal and dropdown patterns increase accessibility risk (focus trap, keyboard interaction, ARIA state).
5. There is no standardized empty/loading/error component pattern.
6. Placeholder screens currently look production-like but are not functionally integrated.

## 5. Style Enhancement Plan Before Migration
### Objective
Improve consistency and maintainability in current React UI before moving to OJET.

### Phase A: Design System Stabilization (1 sprint)
1. Introduce reusable layout primitives:
   1. `PageSection`
   2. `SectionToolbar`
   3. `DataState`
   4. `AppDialog`
2. Normalize typography scale, spacing tokens, and action placement.
3. Establish a standard content contract:
   1. Header
   2. Status summary
   3. Action row
   4. Content body

### Phase B: Screen Refactors (1-2 sprints)
1. Split `InitiativesScreen` and `ExecutiveReportScreen` into smaller feature modules.
2. Extract shared domain logic:
   1. Date parsing/range utilities
   2. RAG evaluation utilities
3. Replace repeated table and modal markup with reusable wrappers.
4. Replace ad hoc filter dropdown logic with a shared filter component.

### Phase C: Accessibility and UX Hardening (1 sprint)
1. Keyboard and focus handling for all overlays/dialogs.
2. ARIA upgrades for sortable tables and filter controls.
3. Consistent empty/loading/error states.

## 6. OJET Migration Strategy
### Recommended Target
OJET virtual DOM architecture (TypeScript) with Core Pack components where available, aligned to Redwood design patterns.

### Principles
1. Migrate by vertical screen slices, not by low-level component rewrite only.
2. Keep backend contracts (`/api/*`) stable to isolate frontend migration risk.
3. Move shared business rules into framework-neutral utilities before or during migration.
4. Avoid long-lived dual-UI mode unless required for cutover safety.

### Pattern Mapping (Current -> OJET Direction)
| Current pattern | OJET direction |
|---|---|
| Custom panels/cards | OJET layout + card/container patterns |
| Custom status pills | OJET badges/labels and semantic status tokens |
| Custom tables + sort/filter | OJET table/data-grid + data provider model |
| Custom dialogs/overlays | OJET dialog components |
| Local state navigation in `App.tsx` | OJET router/navigation patterns |
| Manual fetch + ad hoc loading states | Service layer + standardized view-state model |

## 7. Phased OJET Roadmap
### Phase 0: Foundation and Decisions (1-2 weeks)
1. Finalize OJET app architecture and coding conventions.
2. Set up project scaffold, navigation shell, theme tokens, and API service layer.
3. Define migration acceptance checklist and quality gates.

Exit criteria:
1. OJET shell runs inside current desktop workflow.
2. One shared data/state pattern is established.

### Phase 1: Low-Complexity Screens (2 weeks)
1. Team Insights
2. Individual Insights
3. Security
4. Incident Response
5. Releases

Exit criteria:
1. All low-complexity screens migrated.
2. Placeholder framework is standardized.

### Phase 2: Medium-Complexity Screens (2-3 weeks)
1. Current Sprint Work
2. Integrations & Field Mapping

Exit criteria:
1. Connection checks, sync controls, and history behave functionally.
2. Table and modal patterns use OJET standards.

### Phase 3: High-Complexity Screens (3-4 weeks)
1. Initiative Insights
2. Executive Report

Exit criteria:
1. Filtering/sorting/configuration flows are complete.
2. OCI GenAI summary and wins/risks drafting flow is equivalent.
3. Initiative selection/reorder flow is stable.

### Phase 4: Hardening and Cutover (1-2 weeks)
1. End-to-end regression testing.
2. Accessibility validation.
3. Performance checks on large datasets.
4. Final production cutover.

Exit criteria:
1. All screens migrated and validated.
2. Legacy React shell can be retired.

## 8. Risk Register and Mitigations
1. Risk: Migration scope expands due to custom interaction behavior.
   1. Mitigation: Freeze behavior contracts per screen before implementation.
2. Risk: Styling drift during Redwood alignment.
   1. Mitigation: Token mapping and side-by-side visual baselines.
3. Risk: Business-rule regressions in RAG and reporting logic.
   1. Mitigation: Extract shared pure functions and add targeted tests.
4. Risk: Accessibility regressions in custom overlays.
   1. Mitigation: Prioritize OJET-native dialog/navigation/table patterns.
5. Risk: Team velocity drop from framework transition.
   1. Mitigation: Pilot with low-complexity screens first and codify patterns.

## 9. Effort Estimate
Estimated total: 8-12 weeks.

Assumptions:
1. Two frontend engineers.
2. Existing backend APIs remain stable.
3. QA support is available during hardening and cutover.

## 10. Recommended Immediate Backlog
1. Create shared `lib/insights` utilities for date + RAG logic.
2. Refactor Initiatives and Executive into modular feature sections.
3. Introduce standardized `DataState` and `AppDialog` in current React UI.
4. Define OJET proof-of-concept for:
   1. One table-heavy screen
   2. One dialog-heavy flow
5. Finalize OJET migration acceptance checklist per screen.

## 11. Reference Material
1. OJET virtual DOM architecture:
   1. https://docs.oracle.com/en/middleware/developer-tools/jet/19/vdom/get-started-virtual-dom-architecture-oracle-jet.html
2. OJET Custom Element overview:
   1. https://docs.oracle.com/en/middleware/developer-tools/jet/19/reference-api/CustomElementOverview.html
3. OJET RESTDataProvider reference:
   1. https://docs.oracle.com/en/middleware/developer-tools/jet/19/reference-api/RESTDataProvider.html
4. OJET Core Pack migration guidance:
   1. https://docs.oracle.com/en/middleware/developer-tools/jet/19/develop/core-pack-migrator.html
