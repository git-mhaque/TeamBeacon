from __future__ import annotations

from datetime import UTC, datetime
from urllib.parse import urlencode

from .interfaces import ConnectorConfig, JiraConnector
from .models import BoardRecord, ChangelogItemRecord, IssueRecord, SprintRecord, SyncBatch


class JiraRestConnectorStub(JiraConnector):
    """
    Hosted JIRA REST connector stub.

    Target APIs:
    - /rest/api/2/search
    - /rest/api/2/issue/{key}?expand=changelog
    - /rest/agile/1.0/board
    - /rest/agile/1.0/board/{id}/sprint
    """

    def __init__(self, config: ConnectorConfig) -> None:
        self.config = config

    def _auth_headers(self) -> dict[str, str]:
        if self.config.auth_mode == "pat_bearer":
            return {"Authorization": f"Bearer {self.config.pat_token}"}
        if self.config.auth_mode == "basic":
            if not self.config.username:
                raise ValueError("username is required for basic auth")
            # TODO: Replace with base64 user:pat encoding header.
            return {"Authorization": "Basic <base64-user-pat>"}
        raise ValueError(f"unsupported auth_mode: {self.config.auth_mode}")

    def search_issues(
        self,
        jql: str,
        start_at: int = 0,
        max_results: int = 100,
    ) -> tuple[list[IssueRecord], SyncBatch]:
        _ = self._auth_headers()
        query = urlencode(
            {"jql": jql, "startAt": start_at, "maxResults": max_results},
            doseq=True,
        )
        _endpoint = f"{self.config.base_url}/rest/api/2/search?{query}"
        # TODO: Call endpoint and map payload to IssueRecord list.
        return [], SyncBatch(next_cursor=None, has_more=False)

    def incremental_issues(
        self,
        updated_since: datetime | None,
        start_at: int = 0,
        max_results: int = 100,
    ) -> tuple[list[IssueRecord], SyncBatch]:
        cursor = updated_since or datetime.now(tz=UTC)
        jql = f"updated >= '{cursor.strftime('%Y-%m-%d %H:%M')}' ORDER BY updated ASC"
        return self.search_issues(jql=jql, start_at=start_at, max_results=max_results)

    def get_boards(self) -> list[BoardRecord]:
        _ = self._auth_headers()
        _endpoint = f"{self.config.base_url}/rest/agile/1.0/board"
        # TODO: Call endpoint and map boards.
        return []

    def get_sprints(self, board_id: int, state: str | None = None) -> list[SprintRecord]:
        _ = self._auth_headers()
        _state_query = f"?state={state}" if state else ""
        _endpoint = f"{self.config.base_url}/rest/agile/1.0/board/{board_id}/sprint{_state_query}"
        # TODO: Call endpoint and map sprints.
        return []

    def get_issue_changelog(self, issue_key: str) -> list[ChangelogItemRecord]:
        _ = self._auth_headers()
        _endpoint = f"{self.config.base_url}/rest/api/2/issue/{issue_key}?expand=changelog"
        # TODO: Call endpoint and map changelog histories/items.
        return []

