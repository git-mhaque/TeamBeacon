# TeamBeacon for Engineering Managers

## Executive Snapshot (TL;DR)
TeamBeacon is a local-first intelligence layer for Engineering Managers (EM) that sits on top of existing delivery data, without changing source records. It combines convenient sync, manager-configured metadata, initiative and sprint-level visibility, and an AI-augmented team dashboard to reduce cognitive load and surface risks earlier. This helps EMs think more systemically, lead higher-quality conversations, and drive better delivery outcomes.

## Purpose
The purpose of this page is to highlight TeamBeacon capabilities and practical value for Engineering Managers (EMs).

## What is TeamBeacon? 
TeamBeacon is a lightweight, intelligent layer on top of existing engineering data sources.

It helps Engineering Managers move from fragmented status gathering to focused delivery leadership by combining synced data, metadata-driven insight, and an AI-augmented team dashboard in a local-first workflow.

Key characteristics:
- Local-first: runs on the Engineering Manager's laptop.
- Non-destructive: does not modify source system data.
- Reads from existing sources and synced local data.
- Insight augmentation: allows EM-configured metadata (Group/Type/Epic metadata) to unlock richer system-level visibility.

## Problem Context and Why It Matters
In large enterprises, Engineering Managers typically oversee:
- Multiple initiatives with mixed timelines (short-cycle and multi-quarter).
- Operational run activities in parallel with delivery commitments.
- High-visibility workstreams where leadership communication quality matters.

Common pain points:
- Delivery signal is scattered across tools and views.
- It is hard to maintain a clear system-level picture of work mix and effort distribution.
- Risk indicators are often identified late.
- Weekly and monthly status communication is time-consuming and manually assembled.

Why this matters:
- Engineering Managers need reliable, system-level visibility across multiple concurrent initiatives and run/ops activities.
- TeamBeacon reduces cognitive load by consolidating progress, risk, scope, and work-mix signals in one place.

## Why TeamBeacon Matters for EMs
TeamBeacon helps Engineering Managers:
- Reduce cognitive load by consolidating critical delivery signals.
- Shift from issue-level noise to system-level insights.
- Identify risk earlier through initiative RAG visibility.
- Save significant time on executive communication artifacts.

## Implemented Capability Highlights

### 1 Settings: Connections, Sync, and Metadata Taxonomy
What is implemented today:
- JIRA sync modes: incremental/since last, custom date, and full sync.
- Epic Group and Work Type configuration for local metadata enrichment.

Manager value:
- Fast refresh of relevant data without heavy manual steps.
- Faster refresh cycles and better work-mix analysis.
- Better system-level understanding of work mix once group/type metadata is configured.

### 2 Initiative Insights
What is implemented today:
- Configured Initiative Summary for overall initiative health.
- Initiative Progress Matrix with filtering, search, sorting, and configurable columns.
- RAG-based visibility for early risk detection.
- Reporting-period-aware metrics.

Manager value:
- A clear view of all active initiative work.
- Lower cognitive overhead through group/type/progress slicing.
- Earlier intervention opportunities when trends turn Amber or Red.

### 3 Sprint Insights
What is implemented today:
- Sprint overview (dates and state breakdown).
- Work mix views by group and type.
- Scope change and blocker visibility.
- Sprint work filtering for targeted drill-down.

Manager value:
- System-level sprint conversations beyond a single team lane.
- Better adaptation to scope creep and blocker patterns.
- More meaningful coaching and operational improvement discussions.
- Faster adaptation during weekly execution cycles.

### 4 Team Dashboard (Killer Feature)
What is implemented today:
- AI-generated Executive Summary using the configured AI provider (OCI, Ollama, or OpenAI).
- AI-generated Wins and Risks using current configured initiative data.
- Progress for key initiatives with RAG indicators and reporting-period progress.
- Work mix by group and type for selected reporting-period output.
- Reporting period control and print-ready output.

Manager value:
- Major time savings for weekly, monthly, and quarterly updates.
- Consistent narrative quality for team, manager, and leadership communication.
- Faster preparation for stakeholder reviews with minimal manual input.

## EM Outcomes
- Better signal quality for decision-making.
- Earlier intervention on delivery risk.
- More consistent leadership communication.
- Reduced time spent compiling status updates.

## Practical EM Use Cases
- Weekly team update: quickly draft summary plus wins and risks.
- Monthly leadership checkpoint: report progress and risk posture by initiative.
- Quarterly review prep: show trend-backed narrative with clear RAG signals.

## Typical Usage Rhythm
- Weekly: Sprint Insights plus Initiative Insights plus AI draft update.
- Monthly: executive summary and risk posture review.
- Quarterly: progress narrative with initiative-level RAG and trends.

## TeamBeacon Technology Stack
TeamBeacon is built as a local-first application with a practical, enterprise-ready stack:
- Frontend: Oracle JET (OJET) for the manager-facing UI and workflow screens.
- Backend: Python services for orchestration, local APIs, and data processing.
- Source integration: JIRA integration for delivery and issue data sync.
- Cloud SDK integration: OCI Python SDK for OCI connectivity when OCI is selected.
- AI capabilities: pluggable provider layer supporting OCI GenAI, local Ollama models, and OpenAI.

## Try TeamBeacon
You can try TeamBeacon from the GitHub repository:
- SSH: `git@github.com:git-mhaque/TeamBeacon.git`
- HTTPS: `https://github.com/git-mhaque/TeamBeacon`
- Suggested quick start:
  1. Clone the repo and configure `config/.env`.
  2. Run mandatory DB setup from repo root: `test -f teambeacon.db || sqlite3 teambeacon.db < services/api/db/migrations/0001_initial.sql`
  3. Start the app: `cd app && npm install && npm run dev`.
