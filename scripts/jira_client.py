"""Jira connectivity helpers."""

from __future__ import annotations

import logging
import sys

from jira import JIRA


class JiraService:
    """Thin wrapper over the jira client to simplify dependency injection."""

    def __init__(self, client: JIRA):
        self._client = client

    @property
    def client(self) -> JIRA:
        return self._client

    def project(self, key: str):  # pragma: no cover - pass-through
        return self._client.project(key)

    def issue(self, key: str, expand: str | None = None):  # pragma: no cover
        if expand is None:
            return self._client.issue(key)
        return self._client.issue(key, expand=expand)

    def search_issues(self, *args, **kwargs):  # pragma: no cover
        return self._client.search_issues(*args, **kwargs)

    def sprints(self, *args, **kwargs):  # pragma: no cover
        return self._client.sprints(*args, **kwargs)

    def client_info(self):  # pragma: no cover
        return self._client.client_info()


def connect_jira(base_url: str, pat_token: str, *, jira_cls=JIRA) -> JiraService:
    """Instantiate a Jira client with robust error handling."""

    try:
        client = jira_cls(server=base_url, token_auth=pat_token)
        return JiraService(client)
    except Exception as exc:  # pragma: no cover - network error path
        logging.error("Failed to connect to JIRA: %s", exc)
        sys.exit(2)


def fetch_project(service: JiraService, project_key: str | None):
    if not project_key:
        return None
    try:
        return service.project(project_key)
    except Exception as exc:
        logging.error("Failed to fetch project details: %s", exc)
        return None


def fetch_issue(service: JiraService, issue_key: str):
    try:
        return service.issue(issue_key, expand="changelog")
    except Exception as exc:
        logging.error("Failed to fetch issue '%s': %s", issue_key, exc)
        return None


def fetch_closed_sprints(service: JiraService, board_id: int) -> list:
    all_sprints: list = []
    start_at = 0
    max_results = 50

    def _start_key(sprint):
        return getattr(sprint, "startDate", "") or ""

    while True:
        batch = service.sprints(board_id, state="closed", startAt=start_at, maxResults=max_results)
        if not batch:
            break
        all_sprints.extend(batch)
        if len(batch) < max_results:
            break
        start_at += max_results

    return sorted([s for s in all_sprints if hasattr(s, "startDate")], key=_start_key, reverse=True)
