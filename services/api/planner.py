"""Local delivery plans, immutable activation baselines and live scope progress."""

from __future__ import annotations

import json
import sqlite3
from dataclasses import dataclass
from datetime import date, datetime, timezone
from pathlib import Path
from typing import Any

from services.api.issues.current_sprint_work import is_subtask_issue_type
from services.api.issues.initiative_deep_dive import (
    _resolve_jira_base_url,
    _resolve_jira_base_url_from_db,
)
from services.api.metadata.epic_config import (
    _connect,
    _current_full_sync_issue_clause,
    _ensure_metadata_schema,
    _resolve_db_path,
    is_completed_epic,
)


class PlanConflict(ValueError):
    """The saved plan has changed since this draft was loaded."""


@dataclass(frozen=True)
class Scope:
    issue_keys: frozenset[str]
    completed_keys: frozenset[str]

    def metrics(self, *, available: bool = True) -> dict[str, Any]:
        total, completed = len(self.issue_keys), len(self.completed_keys)
        return {
            "totalCards": total,
            "completedCards": completed,
            "completionPercent": round(100 * completed / total, 1) if total and available else None,
            "available": available,
        }


def _ensure_schema(conn: sqlite3.Connection) -> None:
    _ensure_metadata_schema(conn)
    migration = Path(__file__).parent / "db/migrations/0002_planner.sql"
    conn.executescript(migration.read_text())


def _text(value: Any, label: str, limit: int, *, required: bool = False) -> str:
    if not isinstance(value, str) or len(value.strip()) > limit or (required and not value.strip()):
        raise ValueError(f"{label} must be {'a nonempty' if required else 'a'} string of at most {limit} characters.")
    return value.strip()


def _date(value: Any, label: str) -> str | None:
    if value is None or value == "":
        return None
    if not isinstance(value, str):
        raise ValueError(f"{label} must be an ISO date.")  # noqa: TRY004 - API validation contract
    try:
        parsed = date.fromisoformat(value)
    except ValueError as exc:
        raise ValueError(f"{label} must be an ISO date.") from exc
    if parsed.isoformat() != value:
        raise ValueError(f"{label} must use YYYY-MM-DD.")
    return value


def _array(value: Any, label: str, limit: int) -> list[Any]:
    if not isinstance(value, list) or len(value) > limit:
        raise ValueError(f"{label} must be an array with at most {limit} entries.")
    return value


def _document(payload: Any) -> dict[str, Any]:
    if not isinstance(payload, dict):
        raise ValueError("A plan object is required.")  # noqa: TRY004 - API validation contract
    status = payload.get("status", "draft")
    if status not in ("draft", "active", "completed", "archived"):
        raise ValueError("Invalid plan status.")
    tracks = []
    track_ids: set[str] = set()
    track_names: set[str] = set()
    for track in _array(payload.get("tracks", [{"id": "default", "name": "Default"}]), "tracks", 50):
        if not isinstance(track, dict):
            raise ValueError("Each track must be an object.")  # noqa: TRY004 - API validation contract
        key = _text(track.get("id"), "Track id", 80, required=True)
        name = _text(track.get("name"), "Track name", 120, required=True)
        if key in track_ids or name.casefold() in track_names:
            raise ValueError("Track ids and names must be unique.")
        track_ids.add(key)
        track_names.add(name.casefold())
        tracks.append({"id": key, "name": name})
    if not tracks:
        raise ValueError("A plan needs at least one track.")
    epics = []
    keys: set[str] = set()
    for epic in _array(payload.get("epics", []), "epics", 200):
        if not isinstance(epic, dict):
            raise ValueError("Each epic placement must be an object.")  # noqa: TRY004 - API validation contract
        key = _text(epic.get("epicKey"), "Epic key", 80, required=True).upper()
        track_id = _text(epic.get("trackId", tracks[0]["id"]), "Track id", 80, required=True)
        if key in keys or track_id not in track_ids:
            raise ValueError("Each epic must be unique and belong to an existing track.")
        keys.add(key)
        start = _date(epic.get("startDate"), "Epic start")
        end = _date(epic.get("endDate"), "Epic finish")
        if start and end and end < start:
            raise ValueError(f"{key}: finish must be on or after start.")
        dependencies = [
            _text(item, "Dependency key", 80, required=True).upper()
            for item in _array(epic.get("dependsOn", []), "dependsOn", 200)
        ]
        if len(set(dependencies)) != len(dependencies):
            raise ValueError("Duplicate dependencies are not allowed.")
        epics.append({
            "epicKey": key, "trackId": track_id, "startDate": start, "endDate": end,
            "dependsOn": dependencies, "notes": _text(epic.get("notes", ""), "Notes", 4000),
        })
    remaining = {}
    for epic in epics:
        dependencies = set(epic["dependsOn"])
        if not dependencies <= keys or epic["epicKey"] in dependencies:
            raise ValueError("Dependencies must reference other epics in this plan.")
        remaining[epic["epicKey"]] = dependencies
    while remaining:
        ready = {key for key, dependencies in remaining.items() if not dependencies}
        if not ready:
            raise ValueError("Circular dependencies are not allowed.")
        remaining = {key: dependencies - ready for key, dependencies in remaining.items() if key not in ready}
    return {
        "name": _text(payload.get("name"), "Plan name", 160, required=True),
        "objective": _text(payload.get("objective", ""), "Objective", 4000),
        "owner": _text(payload.get("owner", ""), "Owner", 160),
        "status": status, "targetDate": _date(payload.get("targetDate"), "Plan target"),
        "tracks": tracks, "epics": epics,
    }


def _inventory(conn: sqlite3.Connection) -> tuple[list[dict[str, Any]], dict[str, Scope]]:
    clause, params = _current_full_sync_issue_clause(conn, "i")
    rows = conn.execute(f"SELECT i.* FROM issues i WHERE 1=1 {clause}", params).fetchall()
    issues = {row["issue_key"]: row for row in rows}
    configured = conn.execute("SELECT * FROM epic_metadata ORDER BY epic_key").fetchall()
    scope: dict[str, set[str]] = {row["epic_key"]: set() for row in configured}
    done: set[str] = set()
    for row in rows:
        if (row["issue_type"] or "").strip().lower() == "epic" or is_subtask_issue_type(row["issue_type"]):
            continue
        current = row
        visited = {row["issue_key"]}
        owner = current["epic_key"]
        while not owner and current["parent_issue_key"]:
            parent = current["parent_issue_key"]
            if parent in scope:
                owner = parent
                break
            if parent in visited or parent not in issues:
                break
            visited.add(parent)
            current = issues[parent]
            owner = current["epic_key"]
        if owner in scope:
            scope[owner].add(row["issue_key"])
        if is_completed_epic(row["status_category"], row["status_name"]):
            done.add(row["issue_key"])
    scopes = {key: Scope(frozenset(keys), frozenset(keys & done)) for key, keys in scope.items()}
    epics = []
    for row in configured:
        key = row["epic_key"]
        issue = issues.get(key)
        epics.append({
            "epicKey": key, "title": issue["summary"] if issue else (row["epic_name"] or key),
            "status": issue["status_name"] if issue else "Unavailable",
            "isCompleted": is_completed_epic(issue["status_category"], issue["status_name"]) if issue else False,
            "startDate": row["timeline_start_date"] if row["timeline_enabled"] else None,
            "endDate": row["target_completion_date"] if row["timeline_enabled"] else None,
            **scopes[key].metrics(available=issue is not None),
        })
    return epics, scopes


def _plan(row: sqlite3.Row, inventory: list[dict[str, Any]], scopes: dict[str, Scope]) -> dict[str, Any]:
    document = json.loads(row["document_json"])
    baseline = json.loads(row["baseline_json"]) if row["baseline_json"] else None
    available = {epic["epicKey"]: epic["available"] for epic in inventory}
    keys: set[str] = set()
    completed: set[str] = set()
    warnings = []
    placements = {epic["epicKey"]: epic for epic in document["epics"]}
    for key, epic in placements.items():
        if not available.get(key):
            warnings.append(f"{key}: source epic is unavailable; progress is incomplete.")
        if key in scopes:
            keys.update(scopes[key].issue_keys)
            completed.update(scopes[key].completed_keys)
        if not epic["startDate"] or not epic["endDate"]:
            warnings.append(f"{key}: schedule is incomplete.")
        if epic["endDate"] and document["targetDate"] and epic["endDate"] > document["targetDate"]:
            warnings.append(f"{key}: finish is after the plan target.")
        for dependency in epic["dependsOn"]:
            predecessor_end = placements[dependency]["endDate"]
            if not predecessor_end or not epic["startDate"]:
                warnings.append(f"{dependency} → {key}: dates are needed to check this dependency.")
            elif predecessor_end >= epic["startDate"]:
                warnings.append(f"{dependency} → {key}: successor must start after predecessor finishes.")
    metrics = Scope(frozenset(keys), frozenset(completed)).metrics(
        available=all(available.get(key, False) for key in placements),
    )
    baseline_keys = set(baseline["issueKeys"]) if baseline else set()
    return {
        **document, "id": row["id"], "version": row["version"],
        "createdAt": row["created_at"], "updatedAt": row["updated_at"],
        "metrics": metrics, "warnings": warnings, "baseline": baseline,
        "scopeChange": {"added": len(keys - baseline_keys), "removed": len(baseline_keys - keys)} if baseline else None,
    }


def get_planner(db_path: str | None = None) -> dict[str, Any]:
    conn = _connect(db_path or _resolve_db_path())
    try:
        _ensure_schema(conn)
        conn.execute("BEGIN")
        inventory, scopes = _inventory(conn)
        plans = [
            _plan(row, inventory, scopes)
            for row in conn.execute("SELECT * FROM delivery_plans ORDER BY updated_at DESC, id DESC")
        ]
        last_synced = conn.execute(
            "SELECT MAX(finished_at) FROM sync_run_history WHERE source_type='jira' AND status='completed'"
        ).fetchone()[0]
        return {
            "plans": plans, "epics": inventory, "lastSyncedAt": last_synced,
            "jiraBaseUrl": _resolve_jira_base_url() or _resolve_jira_base_url_from_db(conn),
        }
    finally:
        conn.close()


def save_plan(payload: Any, db_path: str | None = None) -> dict[str, Any]:
    document = _document(payload)
    plan_id, version = payload.get("id"), payload.get("version")
    if plan_id is not None and (type(plan_id) is not int or plan_id < 1 or type(version) is not int or version < 1):
        raise ValueError("Existing plans require a positive id and version.")
    conn = _connect(db_path or _resolve_db_path())
    try:
        _ensure_schema(conn)
        conn.execute("BEGIN IMMEDIATE")
        existing = conn.execute("SELECT * FROM delivery_plans WHERE id=?", (plan_id,)).fetchone()
        if plan_id is not None and (existing is None or existing["version"] != version):
            raise PlanConflict("This plan changed or was removed. Reload it before saving again.")
        inventory, scopes = _inventory(conn)
        previous_keys = {epic["epicKey"] for epic in json.loads(existing["document_json"])["epics"]} if existing else set()
        if any(epic["epicKey"] not in scopes and epic["epicKey"] not in previous_keys for epic in document["epics"]):
            raise ValueError("Only configured epics can be added to a plan.")
        now = datetime.now(timezone.utc).isoformat()
        baseline = existing["baseline_json"] if existing else None
        if document["status"] == "active" and baseline is None:
            if not document["epics"]:
                raise ValueError("Add at least one epic before activating a plan.")
            baseline = json.dumps({
                "capturedAt": now, "document": document,
                "issueKeys": sorted({key for epic in document["epics"] for key in scopes.get(epic["epicKey"], Scope(frozenset(), frozenset())).issue_keys}),
            })
        if existing:
            conn.execute(
                "UPDATE delivery_plans SET document_json=?, baseline_json=?, version=version+1, updated_at=? WHERE id=?",
                (json.dumps(document), baseline, now, plan_id),
            )
        else:
            cursor = conn.execute(
                "INSERT INTO delivery_plans(document_json,baseline_json,created_at,updated_at) VALUES (?,?,?,?)",
                (json.dumps(document), baseline, now, now),
            )
            plan_id = cursor.lastrowid
        row = conn.execute("SELECT * FROM delivery_plans WHERE id=?", (plan_id,)).fetchone()
        result = _plan(row, inventory, scopes)
        conn.commit()
        return result
    finally:
        conn.close()
