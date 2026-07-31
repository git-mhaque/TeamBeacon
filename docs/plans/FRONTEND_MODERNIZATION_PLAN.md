# TeamBeacon Frontend Modernization Plan

- Status: Proposed
- Date: 31 July 2026
- Scope: Web frontend design and implementation stack
- Decision owner: TeamBeacon maintainers

## 1. Executive Decision

Replace the Oracle JET/Preact/RequireJS frontend with a React and Vite single-page application while preserving the existing Python API, SQLite data model, container deployment, API routes, local development ports, and `app/web` production artifact contract.

The target stack is:

- React 19.2 with strict TypeScript.
- Vite 8.1 for development and production builds.
- React Router in declarative SPA mode, using the current stable compatible release.
- TanStack Query for API-backed server state.
- TanStack Table for the Initiative Progress Matrix and other dense tabular views.
- Tailwind CSS 4 with semantic CSS variables and a small TeamBeacon-owned component layer.
- Radix Primitives for accessible dialog, menu, select, popover, tooltip, and focus-management behavior.
- Chart.js retained during migration, loaded only by chart-heavy routes.
- Vitest, React Testing Library, MSW, Playwright, and axe for automated validation.
- OpenAPI-generated TypeScript types where the FastAPI schema is complete, with a thin typed `fetch` client.

This is an SPA, not a server-rendered public website. Next.js, React Server Components, a Node production server, micro-frontends, Redux, and a second backend are not justified for the current product.

## 2. Outcomes

The modernization should produce:

1. A calmer, modern manager console with stronger information hierarchy.
2. Better use of wide screens without sacrificing readability.
3. Dense tables that remain usable without making the whole page excessively tall or wide.
4. Shareable URLs for every screen, saved view, reporting period, and important filter state.
5. A smaller conceptual stack with no Oracle JET CLI, AMD modules, RequireJS, Redwood theme staging, or framework custom-element bootstrap.
6. Reusable components and feature modules instead of multi-thousand-line screens and one global stylesheet.
7. Preserved API behavior and container operation throughout the migration.
8. A tested cutover with functional, visual, accessibility, and performance gates.

## 3. Current-State Assessment

### 3.1 Architecture

The current frontend uses:

- Oracle JET 20 build tooling and Redwood assets.
- Preact 10 for the application components.
- AMD module output and RequireJS path mapping.
- A JET custom element for the application root.
- Chart.js for charts.
- A hand-written `fetch` client and TypeScript response types.
- Vitest and Preact Testing Library.
- A single container where the Python service serves `app/web`.

Direct Oracle JET runtime use is limited to `registerCustomElement` and `BusyContext` in the application root. Product screens are otherwise standard TSX and browser APIs. This makes a framework cutover practical without changing the backend.

### 3.2 Maintainability Baseline

The current application source is approximately 17,800 lines:

- `app/src/styles/app.css`: approximately 4,500 lines.
- `InitiativesScreen.tsx`: approximately 2,950 lines.
- `TeamDashboardScreen.tsx`: approximately 3,150 lines.
- `TeamInsightsScreen.tsx`: approximately 1,500 lines.
- `IntegrationsScreen.tsx`: approximately 1,400 lines.
- `app/src/lib/api.ts`: approximately 1,175 lines.

The shell and screens also coordinate through global custom browser events. This makes behavior harder to trace, type, test, and reuse.

### 3.3 Live Layout Baseline

At a 1280 by 720 viewport:

- The fixed navigation consumes approximately 304 pixels.
- The main content receives approximately 914 pixels.
- The Initiative screen contains 63 data rows and more than 200 interactive controls.
- The rendered document can exceed 6,900 pixels in height.
- The progress matrix requires horizontal scrolling before useful row content is comfortably visible.

The current visual hierarchy is clear enough to operate, but navigation descriptions, borders, nested cards, large page height, and repeated controls consume space that should be used for data and decisions.

## 4. Product and Design Direction

### 4.1 Design Principles

1. **Signal before chrome:** Progress, risk, movement, ownership, and required action should be visually stronger than containers and decoration.

2. **Wide-screen by design:** Analytics views should use the available viewport. Maximum widths are appropriate for prose and forms, not dashboards and matrices.

3. **Progressive disclosure:** Keep primary status and actions visible. Move explanations, editing forms, column controls, and row details into drawers, popovers, or expandable regions.

4. **Dense but calm:** Use compact controls and rows, consistent spacing, restrained borders, and clear typography. Density must not reduce click targets, focus visibility, or scanability.

5. **State is linkable:** Screen, saved view, reporting period, sort, and primary filters belong in the URL when they affect what the user is seeing.

6. **Status is never color-only:** RAG status must always include a label or icon in addition to color.

7. **One interaction vocabulary:** Filters, dialogs, drawers, tables, empty states, loading states, errors, and destructive confirmations should behave consistently across all screens.

### 4.2 Information Architecture

Group navigation by user intent:

- Overview
  - Team Dashboard
- Delivery
  - Initiative Insights
  - Sprint Insights
  - Team Insights
  - Release Insights
- Reliability
  - Security Insights
  - Operations Insights
- Administration
  - Settings

Recommended routes:

| Route | Screen |
| --- | --- |
| `/dashboard` | Team Dashboard |
| `/initiatives` | Initiative Insights |
| `/sprints` | Sprint Insights |
| `/team` | Team Insights |
| `/releases` | Release Insights |
| `/security` | Security Insights |
| `/operations` | Operations Insights |
| `/settings` | Connections and metadata |

The initial route should be the last successfully visited route, with `/initiatives` as the first-use fallback. Under-construction destinations should use a consistent “Coming soon” treatment and must not appear broken.

### 4.3 Application Shell

The shell should have:

- A 240-pixel expanded navigation and a 72-pixel icon rail.
- Persistent collapse preference.
- Short labels instead of two-line descriptions in every navigation item.
- A compact global header for page title, reporting period, data freshness, and page-level actions.
- Breadcrumbs only on nested configuration/detail routes.
- A skip link, semantic landmarks, visible keyboard focus, and predictable focus movement.
- A content area that grows to the full remaining width.

At 1280 pixels, the collapsed rail should allow at least 1,100 pixels for the main work area after page gutters.

### 4.4 Responsive Layout

| Viewport | Behavior |
| --- | --- |
| `>= 1440px` | Expanded or collapsed rail; full dashboard grid; optional 320-pixel attention panel. |
| `1024px–1439px` | Collapsed rail by default; attention content moves to a drawer; compact filters. |
| `768px–1023px` | Navigation drawer; cards use two or one columns; tables keep local horizontal scroll. |
| `< 768px` | Essential read and triage flows only; forms and data grids use stacked alternatives where practical. |

Do not allow horizontal scrolling on the page itself. When a table needs additional width, scrolling must be contained within the table surface.

### 4.5 Initiative Insights Target

Use this structure:

1. Page header
   - Saved view selector.
   - Reporting period.
   - “Configure initiative” primary action.
   - Secondary actions in an overflow menu.

2. Summary strip
   - Configured epics.
   - Average completion.
   - RAG distribution.
   - Completed in period.
   - Each card includes context or change, not only a large number.

3. Sticky filter toolbar
   - Search.
   - Group, work type, and RAG filters.
   - Quick-filter chips.
   - Active-filter count and clear action.
   - Column preferences in a popover.

4. Progress matrix
   - Sticky header.
   - Sticky epic identity column on wide layouts.
   - Sortable and hideable columns.
   - Default page size of 25 with 25/50/100 options.
   - Compact row density with a comfortable option.
   - Row actions in one menu instead of two permanent buttons.
   - Row selection opens an initiative detail drawer.
   - Pagination rather than whole-page rendering; add row virtualization only if measured datasets justify it.

5. Attention panel
   - RAG distribution.
   - Trending-below-plan queue.
   - Recent movement.
   - Visible beside the matrix on large screens and available as a drawer on smaller screens.

### 4.6 Other Screen Patterns

- **Team Dashboard:** executive narrative first, followed by wins, risks, initiative movement, and work mix. Preserve a dedicated print/export stylesheet.
- **Sprint Insights:** show the current sprint state and exceptions before detailed work lists.
- **Team Insights:** keep trend-window selection in the page header and use synchronized chart legends, axes, and tooltips.
- **Release Insights:** separate release readiness from historical cycle-time analysis.
- **Settings:** use tabs for Connections, Metadata, AI, and Diagnostics. Connection cards should prioritize status, last success, next action, and expandable technical detail.
- **Security and Operations:** use one reusable coming-soon state until real workflows exist.

### 4.7 Visual System

Create semantic tokens rather than page-specific colors:

- Background, surface, elevated surface, border, text, muted text, and focus ring.
- Brand, information, success, warning, and danger scales.
- RAG tokens with accessible foreground/background pairs.
- Four-pixel spacing base with a documented compact density scale.
- Consistent radii and two restrained elevation levels.
- Self-hosted variable font or system-font stack; no runtime dependency on an external font CDN.
- Lucide icons with consistent 16, 20, and 24-pixel sizes.

Use a neutral, slightly warm application background with white surfaces and a blue brand accent. Keep RAG colors reserved for status. Dark mode is deferred until the light theme and chart palette meet accessibility and visual-regression gates.

## 5. Target Technical Architecture

### 5.1 Stack Decisions

| Concern | Current | Target | Rationale |
| --- | --- | --- | --- |
| UI runtime | Oracle JET vDOM + Preact | React 19.2 | Mature ecosystem, strong TypeScript and testing support, and a straightforward TSX port. |
| Build | OJET CLI, AMD, RequireJS | Vite 8.1 | Native ESM development, fast builds, less configuration, and static production output. |
| Routing | Component state | React Router | Shareable routes, active navigation, lazy route chunks, and browser history. |
| Server state | Per-screen effects and fetch calls | TanStack Query | Shared caching, retry, invalidation, loading, and error behavior. |
| Tables | Hand-built table behavior | TanStack Table | Typed sorting, filtering, pagination, visibility, and column state without imposing a visual theme. |
| Styling | Redwood theme plus global CSS | Tailwind CSS 4 plus semantic tokens | Consistent constraints, zero-runtime styling, and smaller feature-local styling surfaces. |
| UI primitives | Hand-built dropdowns and dialogs | TeamBeacon components using Radix Primitives | Accessible keyboard, focus, and overlay behavior while retaining full design control. |
| Forms | Local state per form | React Hook Form plus Zod where validation is non-trivial | Typed validation and consistent mutation/error handling. |
| API types | Hand-written response types | OpenAPI-generated types plus thin fetch wrapper | Reduces frontend/backend contract drift. |
| Charts | Chart.js | Retain Chart.js initially | Avoids combining a framework migration with an unnecessary visualization rewrite. |
| Unit tests | Vitest + Preact Testing Library | Vitest + React Testing Library + MSW | Preserves the existing test model while improving network-level component tests. |
| Browser tests | Limited/manual | Playwright + axe | Covers routing, responsive behavior, keyboard flows, visual regression, and accessibility. |

Use exact dependency versions in `package-lock.json`. Adopt only stable releases and verify Node compatibility in the foundation spike. Do not enable React Compiler during the initial migration; assess it after table and chart compatibility is proven.

### 5.2 Source Layout

Target structure:

```text
app/
  src/
    app/
      App.tsx
      router.tsx
      providers.tsx
    components/
      ui/                    # TeamBeacon-owned primitives
      layout/                # Shell, navigation, header, page layout
      data-display/          # KPI, RAG, chart, table building blocks
      feedback/              # Empty, loading, error, toast states
    features/
      dashboard/
      initiatives/
      sprints/
      team/
      releases/
      settings/
      security/
      operations/
    api/
      client.ts
      generated.ts
      queryKeys.ts
    lib/
      persistence.ts
      formatting.ts
      dates.ts
    styles/
      index.css
      tokens.css
      print.css
    main.tsx
  tests/
  e2e/
  index.html
  vite.config.ts
```

Feature folders may contain `components`, `hooks`, `queries`, `schemas`, `types`, and tests. Business rules and metric calculations must remain in the Python service or shared backend packages.

### 5.3 State Rules

- TanStack Query owns API-derived server state.
- React Router owns navigation and URL-backed filter state.
- Component state owns short-lived UI behavior such as an open popover.
- `localStorage` owns non-sensitive user preferences such as density and collapsed navigation.
- React context is limited to cross-cutting application concerns.
- Do not introduce Redux unless a concrete state problem remains after these boundaries are applied.
- Replace global custom DOM events with typed props, router state, query invalidation, or narrowly scoped context.

### 5.4 API and Container Compatibility

The migration must preserve:

- Existing `/api/*` endpoints and payload behavior.
- Local API at `http://localhost:8000`.
- Frontend development at `http://localhost:5174`.
- Same-origin API calls in the production container.
- Production output at `app/web`.
- Existing FastAPI SPA fallback for deep links.
- Existing `npm run dev`, `npm run build`, and `npm run test:coverage` developer contracts.
- Existing local-storage keys where preferences should survive the cutover.
- A single production container with no Node runtime in the final image.

Vite should proxy `/api` to port 8000 during development and emit static assets directly into `app/web` for production.

## 6. Migration Strategy

Use a short-lived parallel frontend on a dedicated feature branch. Do not ship or maintain two production frontends.

The temporary workspace should be `app-next/`. It exists only to allow screen-by-screen parity checks while `app/` remains a working reference. At cutover:

1. Remove the legacy `app/` implementation.
2. Move the modern workspace to `app/`.
3. Configure output as `app/web`.
4. Restore the standard npm command names.
5. Remove every OJET, Preact, RequireJS, and Redwood dependency and generated artifact.
6. Update the Docker build and documentation only where the artifact contract changed.

### Phase 0: Baseline and Design Contract

Deliverables:

- Route and workflow inventory for all eight destinations.
- API endpoint and response-type inventory.
- Golden screenshots at 1280, 1440, and 1920 pixels.
- Mobile/tablet behavior decision for each data-heavy screen.
- Token sheet and low-fidelity shell, Initiative, Settings, and Dashboard layouts.
- Accessibility baseline and keyboard-flow checklist.
- Bundle, render, and table-interaction performance baseline.

Exit criteria:

- Every current user-visible action is classified as preserve, redesign, defer, or remove.
- Design direction is approved before high-volume screen porting.

### Phase 1: Foundation

Deliverables:

- React/Vite/TypeScript workspace.
- Vite development proxy and `app/web`-compatible production build.
- Router, query client, error boundary, and toast infrastructure.
- Design tokens and initial UI primitives.
- ESLint, formatting, Vitest, Testing Library, MSW, Playwright, and axe configuration.
- Generated OpenAPI type script and schema-completeness report.

Exit criteria:

- Empty application shell builds and runs in local and container workflows.
- Deep-link refresh returns the SPA.
- CI enforces lint, typecheck, tests, coverage, and production build.

### Phase 2: Shell and Shared Components

Deliverables:

- Responsive navigation and global header.
- Page, section, KPI, status, empty, loading, and error components.
- Dialog, drawer, menu, select, tooltip, tabs, and confirmation patterns.
- Shared query keys, API error mapping, date formatting, and preference utilities.
- Story or fixture page for component review without live integrations.

Exit criteria:

- Shell works at all target breakpoints.
- Keyboard navigation and focus management pass automated and manual checks.
- No feature screen creates a second version of an existing primitive.

### Phase 3: Feature Migration

Port in this order:

1. Security and Operations shared coming-soon route.
2. Settings and integration status.
3. Sprint Insights.
4. Team Insights and shared chart components.
5. Release Insights.
6. Initiative Insights and Progress Matrix.
7. Team Dashboard and print/export behavior.

For each route:

- Extract pure formatting and transformation logic from the legacy screen.
- Add typed queries and mutations.
- Port success, empty, loading, partial-data, and failure states.
- Add unit and integration tests.
- Add keyboard and accessibility coverage.
- Capture responsive visual snapshots.
- Run side-by-side behavior review against the legacy route.

Exit criteria:

- A route is not considered migrated until behavior, tests, and responsive screenshots pass.

### Phase 4: Cutover and Legacy Removal

Deliverables:

- Modern workspace moved into `app/`.
- Standard npm scripts restored.
- OJET CLI, Oracle JET packages, Preact, RequireJS, path mapping, hooks, staged themes, and legacy global CSS removed.
- Docker and CI build the Vite artifact.
- Architecture, plan, design, README, and contributor documentation updated.

Exit criteria:

- No legacy stack reference remains in source, package lock, CI, Docker, or documentation.
- One production frontend and one production build path remain.
- The container smoke test passes with direct navigation to every route.

### Phase 5: Optimization and Release

Deliverables:

- Route-level code splitting.
- Chart.js explicit registration and chart-route lazy loading.
- Table pagination tuning based on representative datasets.
- Performance and accessibility audit.
- Cross-browser validation.
- User acceptance review with representative manager workflows.

Exit criteria:

- All acceptance gates in Section 7 pass.

## 7. Acceptance Gates

### 7.1 Functional

- All existing completed workflows remain available.
- Every destination has a stable URL and survives refresh.
- Reporting-period and saved-view context remains consistent across applicable screens.
- Mutations invalidate and refresh the correct query data.
- Loading, empty, partial, stale, and error states are distinguishable.
- Dashboard export/print remains usable.

### 7.2 Layout and Usability

- No page-level horizontal scroll at 1280 pixels or wider.
- At 1280 by 720, the Initiative screen shows its header, summary strip, filters, table header, and useful rows without page scrolling.
- The progress matrix uses a bounded surface rather than rendering all rows into the page.
- Navigation collapses to 72 pixels and remembers the preference.
- Primary actions are visually distinct; destructive actions require confirmation.
- Filters can be cleared in one action and active filtering is obvious.

### 7.3 Accessibility

- Target WCAG 2.2 AA.
- Zero critical or serious axe violations on completed routes.
- All workflows operate by keyboard.
- Focus remains visible and is restored after dialogs and drawers close.
- Every chart has a text summary or accessible data alternative.
- RAG and trend meaning never relies only on color.
- Reduced-motion preference is respected.

### 7.4 Performance

- Initial application shell JavaScript target: no more than 250 KB compressed.
- Large chart and feature code loads by route rather than in the initial shell.
- Route transition to cached data feels immediate.
- Client-side filtering or sorting of 1,000 representative rows completes within 100 milliseconds on the agreed development reference machine.
- Core Web Vitals target: LCP below 2.5 seconds and INP below 200 milliseconds in the container smoke environment.
- Performance budgets are measured in CI once a deterministic fixture dataset exists.

### 7.5 Quality

- `npm run lint`, `npm run typecheck`, `npm run build`, and `npm run test:coverage` pass.
- Changed frontend modules maintain at least 90% combined coverage.
- Critical flows have Playwright coverage.
- Visual regression covers the shell and primary dashboard states at agreed breakpoints.
- The production container passes health, static asset, API, and deep-link smoke tests.

## 8. Risks and Mitigations

| Risk | Mitigation |
| --- | --- |
| Business and presentation logic are mixed in large screens. | Extract and test pure transformation functions before porting markup. |
| A redesign can hide functional parity gaps. | Maintain a workflow inventory and side-by-side acceptance checklist per route. |
| A temporary parallel workspace becomes permanent. | Set deletion of the legacy workspace as a non-negotiable cutover gate. |
| FastAPI OpenAPI responses are incomplete or too generic. | Generate types where reliable; improve response models incrementally and retain reviewed local types temporarily. |
| Table virtualization harms semantics or keyboard behavior. | Start with accessible pagination; add virtualization only after measured need and accessibility testing. |
| Tailwind usage becomes inconsistent or unreadable. | Centralize tokens and variants in owned components; prohibit repeated ad-hoc component recipes. |
| React and chart dependencies inflate the bundle. | Lazy-load routes and charts, register only required Chart.js capabilities, and enforce bundle budgets. |
| Newly released tooling creates compatibility churn. | Pin exact stable versions, avoid prereleases, and complete a foundation compatibility spike before feature migration. |
| Live integration data makes tests unreliable. | Use MSW fixtures and deterministic E2E seed data; keep live smoke tests separate. |

## 9. Deliberate Non-Goals

- No backend language or framework change.
- No database change.
- No SSR, React Server Components, or SEO work.
- No Node server in the runtime image.
- No micro-frontend architecture.
- No global state library without demonstrated need.
- No chart-library rewrite during the framework migration.
- No dark theme in the initial cutover.
- No new product capabilities until parity is complete, except changes required by the approved design.

## 10. Work Packages

Suggested implementation backlog:

1. `frontend-foundation`: scaffold React/Vite and quality tooling.
2. `frontend-contracts`: add OpenAPI type generation and typed client.
3. `design-system`: tokens and accessible UI primitives.
4. `app-shell`: routing, navigation, header, context, and responsive behavior.
5. `settings`: connections, sync, metadata, AI, and diagnostics.
6. `sprint-insights`: current sprint, work mix, scope, and blocker views.
7. `team-insights`: trend controls, data cards, charts, and details.
8. `release-insights`: readiness, cycle time, and risk.
9. `initiative-insights`: saved views, KPI strip, filters, matrix, and detail drawer.
10. `team-dashboard`: leadership summary, drill-down, print, and export.
11. `legacy-cutover`: remove OJET/Preact/RequireJS and swap build artifacts.
12. `frontend-hardening`: accessibility, visual regression, performance, and container smoke tests.

## 11. Estimated Delivery Shape

Indicative effort after design approval:

- One engineer: approximately five to seven weeks.
- Two engineers with coordinated feature ownership: approximately three to four weeks.

The Initiative and Team Dashboard screens are the largest uncertainty because they combine the most UI code, state, and reporting behavior. Estimate these only after the foundation and one representative dashboard route are complete.

## 12. Decision Checkpoints

1. Approve the design principles, navigation, density, and Initiative layout.
2. Approve the foundation spike and dependency set.
3. Approve the first fully migrated representative route.
4. Confirm feature parity before legacy deletion.
5. Approve accessibility, performance, and container evidence before merge.

## 13. Reference Material

- [React versions](https://react.dev/versions)
- [Vite releases](https://vite.dev/releases)
- [Vite guide](https://vite.dev/guide/)
- [React Router routing](https://reactrouter.com/start/declarative/routing)
- [TanStack Query for React](https://tanstack.com/query/latest/docs/framework/react/installation)
- [TanStack Table](https://tanstack.com/table/latest/docs/introduction)
- [Tailwind CSS with Vite](https://tailwindcss.com/docs/installation/using-vite)
- [Radix accessibility](https://www.radix-ui.com/primitives/docs/overview/accessibility)
- [shadcn/ui principles](https://ui.shadcn.com/docs)
- [OpenAPI TypeScript](https://openapi-ts.dev/introduction)
- [Playwright accessibility testing](https://playwright.dev/docs/accessibility-testing)
