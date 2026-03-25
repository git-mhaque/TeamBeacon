from __future__ import annotations

import sqlite3
from typing import Any

from services.api.integrations.jira_sync import _ensure_schema, _resolve_db_path


def _clean(value: str | None) -> str | None:
    if value is None:
        return None
    stripped = value.strip()
    return stripped or None


def search_synced_issues(
    *,
    epic_key: str | None = None,
    assignee: str | None = None,
    reporter: str | None = None,
    worked_by: str | None = None,
    issue_type: str | None = None,
    status: str | None = None,
    updated_since: str | None = None,
    updated_until: str | None = None,
    limit: int = 100,
    db_path: str | None = None,
) -> dict[str, Any]:
    filters = {
        "epicKey": _clean(epic_key),
        "assignee": _clean(assignee),
        "reporter": _clean(reporter),
        "workedBy": _clean(worked_by),
        "issueType": _clean(issue_type),
        "status": _clean(status),
        "updatedSince": _clean(updated_since),
        "updatedUntil": _clean(updated_until),
    }

    safe_limit = max(1, min(int(limit), 500))
    resolved_db_path = db_path or _resolve_db_path()

    where_clauses: list[str] = []
    params: list[Any] = []

    if filters["epicKey"]:
        where_clauses.append(
            """
            (
              i.issue_key = ?
              OR i.epic_key = ?
              OR EXISTS (
                SELECT 1
                FROM issues p
                WHERE p.issue_key = i.parent_issue_key
                  AND (p.issue_key = ? OR p.epic_key = ?)
              )
            )
            """
        )
        params.extend(
            [
                filters["epicKey"],
                filters["epicKey"],
                filters["epicKey"],
                filters["epicKey"],
            ]
        )

    if filters["assignee"]:
        where_clauses.append("i.assignee_account_id = ?")
        params.append(filters["assignee"])

    if filters["reporter"]:
        where_clauses.append("i.reporter_account_id = ?")
        params.append(filters["reporter"])

    if filters["workedBy"]:
        where_clauses.append(
            """
            (
              i.assignee_account_id = ?
              OR i.reporter_account_id = ?
              OR EXISTS (
                SELECT 1
                FROM issue_changelog c
                WHERE c.issue_key = i.issue_key
                  AND c.author_account_id = ?
              )
            )
            """
        )
        params.extend(
            [
                filters["workedBy"],
                filters["workedBy"],
                filters["workedBy"],
            ]
        )

    if filters["issueType"]:
        where_clauses.append("i.issue_type = ?")
        params.append(filters["issueType"])

    if filters["status"]:
        where_clauses.append("i.status_name = ?")
        params.append(filters["status"])

    if filters["updatedSince"]:
        where_clauses.append("datetime(COALESCE(i.updated_at_source, i.synced_at)) >= datetime(?)")
        params.append(filters["updatedSince"])

    if filters["updatedUntil"]:
        where_clauses.append("datetime(COALESCE(i.updated_at_source, i.synced_at)) <= datetime(?)")
        params.append(filters["updatedUntil"])

    query = """
        SELECT
          i.issue_key,
          i.issue_type,
          i.summary,
          i.status_name,
          i.assignee_account_id,
          i.reporter_account_id,
          i.story_points,
          i.sprint_external_id,
          i.epic_key,
          i.parent_issue_key,
          i.updated_at_source,
          i.resolved_at_source
        FROM issues i
    """
    if where_clauses:
        query += f" WHERE {' AND '.join(where_clauses)}"
    query += " ORDER BY datetime(COALESCE(i.updated_at_source, i.synced_at)) DESC, i.issue_key ASC LIMIT ?"
    params.append(safe_limit)

    conn = sqlite3.connect(resolved_db_path)
    conn.row_factory = sqlite3.Row
    try:
        _ensure_schema(conn)
        issue_rows = conn.execute(query, params).fetchall()

        issue_keys = [str(row["issue_key"]) for row in issue_rows if row["issue_key"]]
        contributors_by_issue: dict[str, list[str]] = {issue_key: [] for issue_key in issue_keys}

        if issue_keys:
            placeholders = ",".join("?" for _ in issue_keys)
            contributor_rows = conn.execute(
                f"""
                SELECT DISTINCT issue_key, author_account_id
                FROM issue_changelog
                WHERE issue_key IN ({placeholders})
                  AND author_account_id IS NOT NULL
                  AND TRIM(author_account_id) <> ''
                ORDER BY issue_key ASC, author_account_id ASC
                """,
                issue_keys,
            ).fetchall()
            for contributor_row in contributor_rows:
                issue_key = str(contributor_row["issue_key"])
                contributor = str(contributor_row["author_account_id"])
                contributors_by_issue.setdefault(issue_key, []).append(contributor)
    finally:
        conn.close()

    issues: list[dict[str, Any]] = []
    for row in issue_rows:
        issue_key = str(row["issue_key"])
        issues.append(
            {
                "issueKey": issue_key,
                "issueType": row["issue_type"],
                "summary": row["summary"],
                "status": row["status_name"],
                "assigneeAccountId": row["assignee_account_id"],
                "reporterAccountId": row["reporter_account_id"],
                "storyPoints": row["story_points"],
                "sprintExternalId": row["sprint_external_id"],
                "epicKey": row["epic_key"],
                "parentIssueKey": row["parent_issue_key"],
                "updatedAt": row["updated_at_source"],
                "resolvedAt": row["resolved_at_source"],
                "contributors": contributors_by_issue.get(issue_key, []),
            }
        )

    return {
        "source": "local",
        "filters": filters,
        "count": len(issues),
        "issues": issues,
    }

