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
- `JIRA_SPRINT_FIELDS` (comma-separated sprint field priority; default: `sprint,customfield_10901,customfield_10020`)
- `JIRA_AUTH_MODE` (`pat_bearer` default, `basic` also supported)
- `JIRA_USERNAME` (only needed for `basic` auth mode)
- `JIRA_TIMEOUT_SECONDS` (default: `30`)
- `RUN_LIVE_JIRA_TESTS` (`1` enables live integration tests)

## OCI GenAI Variables
- `OCI_GENAI_COMPARTMENT_ID` (required)
- `OCI_GENAI_ENDPOINT` (required, e.g. `https://inference.generativeai.us-chicago-1.oci.oraclecloud.com`)
- `OCI_GENAI_MODEL_ID` (required, e.g. `cohere.command-r-08-2024`)
- `OCI_GENAI_CONFIG_PROFILE` (default: `DEFAULT`)
- `OCI_GENAI_CONFIG_FILE` (default: `~/.oci/config`)
- `OCI_GENAI_MAX_TOKENS` (default: `600`)
- `OCI_GENAI_TEMPERATURE` (default: `1`)
- `OCI_GENAI_TOP_P` (default: `0.75`)
- `OCI_GENAI_TOP_K` (default: `0`)
- `OCI_GENAI_FREQUENCY_PENALTY` (default: `0`)
- `OCI_GENAI_CONNECT_TIMEOUT_SECONDS` (default: `10`)
- `OCI_GENAI_READ_TIMEOUT_SECONDS` (default: `240`)
