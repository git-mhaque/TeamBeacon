# Local Database Access and Sample Queries

Use these steps to inspect locally synced TeamBeacon data in SQLite.

## 1. Verify the Local DB Exists

```bash
ls -lh teambeacon.db
```

## 2. Open SQLite Shell

```bash
sqlite3 teambeacon.db
```

## 3. List Tables

```sql
.tables
```

## 4. Sample Inspection Queries

Issue and sprint totals:

```sql
SELECT COUNT(*) AS issues_count FROM issues;
SELECT COUNT(*) AS sprints_count FROM sprints;
```

Configured board rows:

```sql
SELECT external_board_id, name, project_key, updated_at
FROM boards;
```

Recent issues:

```sql
SELECT issue_key, summary, status_name, assignee_account_id, updated_at_source
FROM issues
ORDER BY updated_at_source DESC
LIMIT 20;
```

Sync checkpoint state and last sync timestamp:

```sql
SELECT source_type, scope_key, status, last_synced_at, error_message
FROM sync_checkpoints
ORDER BY updated_at DESC;
```

## 5. Exit SQLite

```sql
.quit
```

## Optional: Run One Query Without Entering SQLite Shell

```bash
sqlite3 -header -column teambeacon.db "SELECT issue_key, summary, status_name FROM issues ORDER BY updated_at_source DESC LIMIT 20;"
```
