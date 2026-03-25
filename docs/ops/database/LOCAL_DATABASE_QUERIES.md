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

Epic-child mapping:

```sql
SELECT issue_key, issue_type, epic_key, parent_issue_key
FROM issues
WHERE issue_key = 'CEGBUPOL-4482'
   OR epic_key = 'CEGBUPOL-4482'
   OR parent_issue_key IN (
       SELECT issue_key FROM issues WHERE epic_key = 'CEGBUPOL-4482'
   )
ORDER BY issue_key;
```

Contributors from full changelog (all users who touched a card):

```sql
SELECT c.issue_key, c.author_account_id, COUNT(*) AS change_events
FROM issue_changelog c
WHERE c.author_account_id IS NOT NULL
GROUP BY c.issue_key, c.author_account_id
ORDER BY c.issue_key, change_events DESC;
```

Issues worked by one user (current owner or changelog contributor):

```sql
SELECT DISTINCT i.issue_key, i.summary, i.status_name
FROM issues i
LEFT JOIN issue_changelog c ON c.issue_key = i.issue_key
WHERE i.assignee_account_id = 'user-qa'
   OR i.reporter_account_id = 'user-qa'
   OR c.author_account_id = 'user-qa'
ORDER BY i.issue_key;
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
