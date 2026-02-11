# Team Pilot
`Team Pilot` transforms raw Jira data into actionable intelligence. By orchestrating automated workflows through the lens of three expert AI personas — `The Scrum Master`, `The Agile Coach`, and `The Delivery Manager` — it provides the navigation and insights teams need to land their sprints on time, every time.

|Persona | Role	| Focus Area |
|---|--|---|
| Scrum Master	| The Navigator |	Tactical sprint execution and obstacle removal.| 
| Agile Coach	| The Flight Instructor	| Long-term growth, health metrics, and cultural evolution. | 
| Delivery Manager |	The Mission Director |	Strategic alignment across multiple initiatives and timelines. |


This project orchestrates and automates team workflows and generates insights via Cline workflows. These workflows use Jira as a primary data source and leverage Python to fetch and preprocess relevant data, and then utilize AI to generate insightful artifacts. 


# Quick Set Up

## Set Up Environment Variables

Copy the example environment file and update it with your details:
```
cp .env.example .env
```

Edit `.env` and set the required environment variables.

- `JIRA_BASE_URL`: Your JIRA URL.
- `JIRA_PAT`: Your JIRA Personal Access Token (PAT). 
- `JIRA_PROJECT_KEY`: Your Jira project key (e.g., MYPROJ).
- `JIRA_BOARD_ID`: The ID of your Jira Agile board (integer). 
- `JIRA_STORY_POINTS_FIELD`: The custom field ID for story points (e.g., customfield_10004). 

## Set Up Cline Rules 

Create `Config.md` under `.clinerules` with following information:
```
# Jira 
- Jira project: <Your Jira Project Key>
- Agile board: <Your Agile Board Name>

# Conflucne 
- Space key: <Default Space Key>
- Create all pages under this parent page: `<Default Parent Page>` (pageId=<PArent Page ID>)
- Overwrite or update if any page with the same name already exists
```

# Run Workflows

## Data Extraction  

```
\team-data.md 
```

## Insight Generation 

```
\sprint-insights.md 
```

```
\team-insights.md 
```

```
\initiative-insights.md 
```

# Schedule Workflows 

Schedule the above workflows based on your preferred cadence. 