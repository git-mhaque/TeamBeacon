# TeamBeacon OJET Workspace

This directory is the Oracle JET (vDOM) migration workspace for TeamBeacon.

## Current Migration Coverage
1. App shell and screen navigation.
2. Integrations screen with live connectivity checks:
   1. `GET /api/integrations/jira/status`
   2. `GET /api/integrations/oci-genai/status`
3. Team Insights and Individual Insights baseline screens.
4. Current Sprint Work screen with live sprint endpoints:
   1. `GET /api/sprints/current`
   2. `GET /api/sprints/current/work`
   3. `GET /api/sprints/current/changes`
5. Initiative Insights screen with live initiative summary endpoint:
   1. `GET /api/metadata/epics/summary`
   2. `GET /api/integrations/jira/status` (JIRA browse links)
6. Remaining screens are scaffolded placeholders for phased migration.

## Run Locally
1. Start TeamBeacon backend API:
```bash
cd ../app
npm run api:dev
```
2. Build OJET app:
```bash
npm install
npm run build
```
3. Serve OJET app:
```bash
npm run dev
```

Default OJET dev URL: `http://127.0.0.1:5174`

## API Base URL
The OJET baseline uses `http://127.0.0.1:8000` as the default API origin.
