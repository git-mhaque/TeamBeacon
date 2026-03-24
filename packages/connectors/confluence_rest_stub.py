from __future__ import annotations

from datetime import datetime
from urllib.parse import quote_plus

from .interfaces import ConnectorConfig, ConfluenceConnector
from .models import ConfluencePageRecord, SyncBatch


class ConfluenceRestConnectorStub(ConfluenceConnector):
    """
    Hosted Confluence REST connector stub.

    Target APIs:
    - /rest/api/content/{id}
    - /rest/api/content?spaceKey=...&title=...
    - /rest/api/content/search?cql=...
    """

    def __init__(self, config: ConnectorConfig) -> None:
        self.config = config

    def _auth_headers(self) -> dict[str, str]:
        if self.config.auth_mode != "pat_bearer":
            raise ValueError("hosted Confluence stub expects pat_bearer mode")
        return {"Authorization": f"Bearer {self.config.pat_token}"}

    def get_page_by_id(self, page_id: str) -> ConfluencePageRecord:
        _ = self._auth_headers()
        _endpoint = (
            f"{self.config.base_url}/rest/api/content/{page_id}"
            "?expand=body.storage,body.view,version,metadata.labels"
        )
        # TODO: Call endpoint and map payload to ConfluencePageRecord.
        return ConfluencePageRecord(
            page_id=page_id,
            title="",
            space_key=None,
            version_number=None,
            version_when=None,
        )

    def get_page_by_url(self, url: str) -> ConfluencePageRecord:
        _ = self._auth_headers()
        # TODO: Parse pageId from URL when present.
        # TODO: Add resolver for /display/{SPACE}/{Title} path style.
        raise NotImplementedError(f"url resolution not implemented yet: {url}")

    def list_pages_updated_since(
        self,
        updated_since: datetime | None,
        start: int = 0,
        limit: int = 50,
    ) -> tuple[list[ConfluencePageRecord], SyncBatch]:
        _ = self._auth_headers()
        if updated_since:
            cql = f"type=page and lastmodified >= '{updated_since.strftime('%Y-%m-%d %H:%M')}'"
        else:
            cql = "type=page order by lastmodified desc"
        _endpoint = (
            f"{self.config.base_url}/rest/api/content/search?cql={quote_plus(cql)}"
            f"&start={start}&limit={limit}"
        )
        # TODO: Call endpoint and map pages.
        return [], SyncBatch(next_cursor=None, has_more=False)

