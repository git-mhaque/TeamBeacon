"""Configuration utilities for TeamBeacon scripts."""

from __future__ import annotations

import logging
import os
import sys
from dataclasses import dataclass

from dotenv import load_dotenv


load_dotenv()


@dataclass(frozen=True)
class JiraRuntimeConfig:
    """Container for runtime configuration derived from environment variables."""

    project_key: str | None
    board_id: int
    story_points_field: str
    sample_issue_key: str


def _require_env(name: str) -> str:
    """Fetch a required environment variable or exit with a helpful error."""

    value = os.getenv(name)
    if not value:
        logging.error("Please set %s in your environment or .env file.", name)
        sys.exit(1)
    return value


def get_jira_credentials() -> tuple[str, str]:
    """Return the Jira base URL and PAT token, ensuring both are configured."""

    jira_url = _require_env("JIRA_BASE_URL")
    jira_pat = _require_env("JIRA_PAT")
    return jira_url, jira_pat


def load_runtime_config() -> JiraRuntimeConfig:
    """Load non-secret runtime configuration values with sensible defaults."""

    board_id_str = os.getenv("JIRA_BOARD_ID", "27193")
    try:
        board_id = int(board_id_str)
    except ValueError:
        logging.error("JIRA_BOARD_ID must be an integer. Current value: %s", board_id_str)
        sys.exit(1)

    project_key = os.getenv("JIRA_PROJECT_KEY")
    story_points_field = os.getenv("JIRA_STORY_POINTS_FIELD", "customfield_10004")
    sample_issue_key = os.getenv("JIRA_SAMPLE_ISSUE_KEY", "CEGBUPOL-4524")

    return JiraRuntimeConfig(
        project_key=project_key,
        board_id=board_id,
        story_points_field=story_points_field,
        sample_issue_key=sample_issue_key,
    )
