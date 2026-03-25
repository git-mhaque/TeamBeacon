# Configuration

## Files
- `.env.example`: template for local/runtime configuration.
- `.env`: local secrets and runtime settings (ignored by git).

## Required JIRA Variables
- `JIRA_BASE_URL`
- `JIRA_PAT`
- `JIRA_PROJECT_KEY` (recommended for scoped queries)
- `JIRA_BOARD_ID` (required for board/sprint integration tests)
- `JIRA_STORY_POINTS_FIELD`

## Optional Variables
- `JIRA_EPIC_LINK_FIELD` (default: `customfield_10014`; set to your environment value, e.g. `customfield_10902`)
- `JIRA_AUTH_MODE` (`pat_bearer` default, `basic` also supported)
- `JIRA_USERNAME` (only needed for `basic` auth mode)
- `JIRA_TIMEOUT_SECONDS` (default: `30`)
- `RUN_LIVE_JIRA_TESTS` (`1` enables live integration tests)
