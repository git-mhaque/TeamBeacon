# Connector Interfaces

This package defines source connector contracts and lightweight hosted Atlassian stubs for MVP.

## Scope
- `interfaces.py`: abstract interfaces used by workers/services.
- `models.py`: normalized records passed into persistence and metrics layers.
- `jira_rest_stub.py`: hosted JIRA PAT-authenticated implementation stub.
- `confluence_rest_stub.py`: hosted Confluence PAT-authenticated implementation stub.

## Usage
Start workers against interface types, not concrete clients, so connector implementations can be swapped in tests.

