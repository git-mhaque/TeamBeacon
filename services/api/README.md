# TeamBeacon Local API

Lightweight local API endpoints used by the desktop/web shell.

## Run
From repository root:

```bash
python3 -m services.api.server --host 127.0.0.1 --port 8000
```

## Endpoints
- `GET /health`
- `GET /api/integrations/jira/status`

## Notes
- The JIRA status endpoint reads `config/.env` (or process env vars).
- Intended for local desktop runtime and frontend proxy usage.

