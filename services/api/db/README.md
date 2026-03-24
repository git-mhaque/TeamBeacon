# Database Schema

This folder stores SQL migrations for the local analytics database (SQLite in MVP).

## Apply Migration

```bash
sqlite3 teambeacon.db < services/api/db/migrations/0001_initial.sql
```

## Notes
- Use additive migrations only after initial rollout.
- Keep raw API payloads in JSON text columns for traceability.
- Prefer writing calculated values into `metric_snapshots` instead of recomputing on every request.

