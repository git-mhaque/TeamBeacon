# Team Beacon ✨

*Illuminating the path from raw data to delivery excellence.*

**Team Beacon** orchestrates team workflows and generates high-fidelity insights using AI. 

By leveraging Jira as a data source and Python for deep-dive preprocessing, Beacon provides the **"Signal"** within the noise. It utilizes **Cline** workflows to generate artifacts that augment the team through three distinct guiding lights:

- 🔦 **The Tactical Signal (Scrum Master) Focus**: The Now. Empowers the team to manage the sprint by surfacing daily progress trends, scope creep, and potential blockers.

- 🕯️ **The Strategic Signal (Agile Coach) Focus**: The How. Guides long-term growth by tracking health metrics, refining engineering practices, and evolving the team's work culture.

- 🔭 **The Operational Signal (Delivery Manager) Focus**: The Big Picture. Helps the team see the broader landscape and achieve milestones by overseeing multiple initiatives.


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
- `CONFLUENCE_URL`: Your Confluence URL. 
- `CONFLUENCE_PAT`: Your Confluence Personal Access Token (PAT). 
- `CONFLUENCE_SPACE_KEY`: Your Confluence space key. 
- `CONFLUENCE_PARENT_PAGE_ID`: You Confluence parent page ID under which reports will be published.  


# Run Workflows

## Extract Data  

This workflow will extract data from Jira in `./data` directory. 

```
\team-data.md 
```

## Generate Insights 

These workflows with generate markdown reports based on extracted data in `./reports` directory. 

```
\sprint-insights.md 
```

```
\team-insights.md 
```

```
\initiative-insights.md 
```

## Publish Insights 

This workflow will publish reports generated in `./reports` to Confluence.  

```
\publish-insights.md 
```


<!--
# Schedule Workflows 

Schedule the above workflows based on your preferred cadence. 
-->
