"""Epic data aggregation helpers."""

from __future__ import annotations

from .jira_client import JiraService


def get_epics_dataset(service: JiraService, epic_keys: list[str]) -> list[dict]:
    base_url = service.client_info()
    dataset = []

    for key in epic_keys:
        try:
            epic = service.issue(key)
            issues_in_epic = service.search_issues(
                f'parent = "{key}" OR "Epic Link" = "{key}"', maxResults=False
            )

            total = len(issues_in_epic)
            stats = {"To Do": 0, "In Progress": 0, "Done": 0}

            for issue in issues_in_epic:
                if "ACXRM" in getattr(issue, "key", ""):
                    total -= 1
                    continue
                category = issue.fields.status.statusCategory.name
                if category in stats:
                    stats[category] += 1

            def calc_pct(count):
                return round((count / total) * 100, 2) if total > 0 else 0

            dataset.append(
                {
                    "issue_number": epic.key,
                    "title": epic.fields.summary,
                    "link": f"{base_url}/browse/{epic.key}",
                    "total_issues": total,
                    "completed": stats["Done"],
                    "inprogress": stats["In Progress"],
                    "todo": stats["To Do"],
                    "percentage_done": calc_pct(stats["Done"]),
                    "percentage_inprogress": calc_pct(stats["In Progress"]),
                    "percentage_todo": calc_pct(stats["To Do"]),
                }
            )

        except Exception as exc:  # pragma: no cover - network error path
            print(f"Error processing Epic {key}: {exc}")
            continue

    return dataset
