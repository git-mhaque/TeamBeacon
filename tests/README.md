# Test Strategy

## Unit Tests
Unit tests run without network access and validate JIRA mapping/auth/pagination behavior.

```bash
python3 -m unittest discover -s tests/unit -p "test_*.py" -v
```

## Integration Tests (Live JIRA)
Integration tests include:
- Local API server route checks (no external network)
  - Includes JIRA sync status/start endpoint behavior
- Optional live hosted JIRA checks (with credentials)

Run API integration tests:

```bash
python3 -m unittest discover -s tests/integration/api -p "test_*.py" -v
```

Run live JIRA connector tests:

```bash
RUN_LIVE_JIRA_TESTS=1 python3 -m unittest discover -s tests/integration -p "test_*.py" -v
```

## Combined
```bash
python3 -m unittest discover -s tests -p "test_*.py" -v
```
