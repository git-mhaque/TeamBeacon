# Team Beacon ✨

Illuminating the path from raw data to delivery excellence.

**Team Beacon** orchestrates team workflows and generates high-fidelity insights via Cline. 

By leveraging Jira as a data source and Python for deep-dive preprocessing, Beacon provides the "Signal" within the noise. It utilizes AI to generate artifacts that augment the team through three distinct guiding lights:

- 🔦 **The Tactical Signal (Scrum Master) Focus**: The "Now." Keeps the current sprint on track by catching new work (scope creep), monitoring progress, and clearing blockers.

- 🕯️ **The Strategic Signal (Agile Coach) Focus**: The "How." Helps the team grow over time by tracking "health" metrics and building a better work culture.

- 🔭 **The Operational Signal (Delivery Manager) Focus**: The "Big Picture." Oversees multiple initiatives and milestones, and keeps an eye on live operations including system stability.


# Quick Set Up

## Environment Variables

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

## Cline Rules 

Create `Config.md` under `.clinerules` with following information:
```
# Jira 
- Jira project: <Your Jira Project Key>
- Agile board: <Your Agile Board Name>

# Conflucne 
- Space key: <Default Space Key>
- Create all pages under this parent page: `<Default Parent Page>` (pageId=<Parent Page ID>)
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

<!--
# Schedule Workflows 

Schedule the above workflows based on your preferred cadence. 
-->
