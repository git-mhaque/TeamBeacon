# Test Strategy

## Unit Tests
Unit tests run without network access and validate JIRA mapping/auth/pagination behavior.

```bash
python3 -m unittest discover -s tests/unit -p "test_*.py" -v
```

## Integration Tests (Live JIRA)
Integration tests call hosted JIRA APIs using credentials loaded from `config/.env` or environment variables.

```bash
RUN_LIVE_JIRA_TESTS=1 python3 -m unittest discover -s tests/integration -p "test_*.py" -v
```

## Combined
```bash
python3 -m unittest discover -s tests -p "test_*.py" -v
```

