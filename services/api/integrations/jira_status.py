from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from packages.connectors.jira_config import JiraRuntimeConfig, load_env_files
from packages.connectors.jira_rest_stub import JiraAPIError, JiraRestConnector


def _utc_iso_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def get_jira_status() -> dict[str, Any]:
    load_env_files()
    base_payload: dict[str, Any] = {
        "source": "jira",
        "connected": False,
        "checkedAt": _utc_iso_now(),
        "config": {},
        "checks": [],
        "metrics": {},
        "error": None,
    }

    try:
        runtime = JiraRuntimeConfig.from_env()
    except ValueError as exc:
        base_payload["error"] = str(exc)
        base_payload["checks"].append(
            {
                "name": "configuration",
                "ok": False,
                "detail": "Required JIRA environment variables are missing.",
            }
        )
        return base_payload

    base_payload["config"] = {
        "baseUrl": runtime.base_url,
        "projectKey": runtime.project_key,
        "boardId": runtime.board_id,
        "storyPointsField": runtime.story_points_field,
        "authMode": runtime.auth_mode,
    }

    connector = JiraRestConnector(
        config=runtime.to_connector_config(),
        project_key=runtime.project_key,
        story_points_field=runtime.story_points_field,
    )

    checks = []
    metrics: dict[str, Any] = {}
    sample_issue_key: str | None = None

    try:
        boards = connector.get_boards()
        metrics["boardCount"] = len(boards)
        checks.append(
            {
                "name": "board_access",
                "ok": True,
                "detail": f"Retrieved {len(boards)} boards.",
            }
        )

        if runtime.board_id is not None:
            visible = any(board.external_board_id == runtime.board_id for board in boards)
            checks.append(
                {
                    "name": "configured_board_visible",
                    "ok": visible,
                    "detail": (
                        f"Board {runtime.board_id} is accessible."
                        if visible
                        else f"Board {runtime.board_id} is not visible to this token."
                    ),
                }
            )

        if runtime.project_key:
            issues, _ = connector.search_issues(
                jql=f"project = {runtime.project_key} ORDER BY updated DESC",
                max_results=1,
            )
            metrics["projectSampleIssueCount"] = len(issues)
            sample_issue_key = issues[0].issue_key if issues else None
            checks.append(
                {
                    "name": "project_query",
                    "ok": True,
                    "detail": (
                        f"Project query succeeded for {runtime.project_key}."
                        if issues
                        else f"Project query succeeded for {runtime.project_key} (no recent issues)."
                    ),
                }
            )
        else:
            checks.append(
                {
                    "name": "project_query",
                    "ok": False,
                    "detail": "JIRA_PROJECT_KEY not configured.",
                }
            )

        base_payload["connected"] = all(check["ok"] for check in checks if check["name"] != "project_query")
    except JiraAPIError as exc:
        checks.append(
            {
                "name": "api_reachability",
                "ok": False,
                "detail": f"JIRA API error ({exc.status_code or 'n/a'}).",
            }
        )
        base_payload["error"] = str(exc)
    except Exception as exc:  # noqa: BLE001
        checks.append(
            {
                "name": "unexpected_error",
                "ok": False,
                "detail": "Unexpected runtime failure while checking JIRA connectivity.",
            }
        )
        base_payload["error"] = str(exc)

    base_payload["checks"] = checks
    base_payload["metrics"] = metrics
    base_payload["sampleIssueKey"] = sample_issue_key
    return base_payload

