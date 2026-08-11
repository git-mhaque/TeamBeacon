# Connector Interfaces

This package defines source connector contracts and hosted Atlassian connector implementations.

## Scope
- `interfaces.py`: abstract interfaces used by workers/services.
- `models.py`: normalized records passed into persistence and metrics layers.
- `jira_rest_stub.py`: hosted JIRA PAT-authenticated connector implementation.
  - Includes a key-only project snapshot used by sync deletion reconciliation.
- `jira_config.py`: runtime config and `.env` loader for local/integration runs.
- `oci_genai_config.py`: runtime config model for OCI Generative AI endpoints.
- `ollama_config.py`: runtime config model for Ollama local endpoints.
- `openai_config.py`: runtime config model for OpenAI-compatible chat endpoints.
- `intelligence_config.py`: active provider selection (`INTELLIGENCE_PROVIDER`) and provider normalization.
- `confluence_rest_stub.py`: hosted Confluence PAT-authenticated implementation stub.

## Usage
Start workers against interface types, not concrete clients, so connector implementations can be swapped in tests.
