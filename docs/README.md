# Documentation Index

This directory contains product, architecture, plan, and design artifacts for TeamBeacon.

## Core Documents
- [../SPEC.md](../SPEC.md): product requirements, MVP boundaries, and success metrics.
- [architecture/ARCHITECTURE.md](architecture/ARCHITECTURE.md): technical architecture and data flow.
- [plans/PLAN.md](plans/PLAN.md): phased execution plan and delivery milestones.
- [plans/FRONTEND_MODERNIZATION_PLAN.md](plans/FRONTEND_MODERNIZATION_PLAN.md): proposed frontend design system, target stack, migration phases, and acceptance gates.
- [design/README.md](design/README.md): design artifact guide.
- [../services/api/README.md](../services/api/README.md): local API routes, including AI provider and Team Insights endpoints.

## Design Artifacts
- [design/teambeacon-ojet-mockups.html](design/teambeacon-ojet-mockups.html): Oracle JET-oriented UI mockups for current TeamBeacon screens.
- [design/redwood-ojet-dashboard.html](design/redwood-ojet-dashboard.html): focused Redwood Oracle JET dashboard mockup for Initiative Insights.

## Operations Runbooks
- [ops/OCI_GENAI_CONNECTIVITY_SMOKE_TEST.md](ops/OCI_GENAI_CONNECTIVITY_SMOKE_TEST.md): OCI-specific smoke test for connectivity and chat execution (`INTELLIGENCE_PROVIDER=oci`).
- [ops/database/LOCAL_DATABASE_QUERIES.md](ops/database/LOCAL_DATABASE_QUERIES.md): local SQLite inspection and sample queries.

## Maintenance Rule
When product scope or UX flow changes, update these files together:
1. `SPEC.md`
2. `architecture/ARCHITECTURE.md`
3. `plans/PLAN.md`
4. `design/teambeacon-ojet-mockups.html`
5. `services/api/README.md` (if API contract/endpoints changed)
