PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS schema_migrations (
  version TEXT PRIMARY KEY,
  applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS integration_configs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_type TEXT NOT NULL CHECK (source_type IN ('jira', 'confluence')),
  name TEXT NOT NULL,
  base_url TEXT NOT NULL,
  auth_mode TEXT NOT NULL DEFAULT 'pat_bearer',
  token_keychain_ref TEXT NOT NULL,
  username_keychain_ref TEXT,
  is_enabled INTEGER NOT NULL DEFAULT 1,
  settings_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(source_type, name)
);

CREATE TABLE IF NOT EXISTS sync_checkpoints (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_type TEXT NOT NULL CHECK (source_type IN ('jira', 'confluence')),
  scope_key TEXT NOT NULL,
  last_cursor TEXT,
  last_synced_at TEXT,
  status TEXT NOT NULL DEFAULT 'idle',
  error_message TEXT,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(source_type, scope_key)
);

CREATE TABLE IF NOT EXISTS sync_run_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_type TEXT NOT NULL CHECK (source_type IN ('jira', 'confluence')),
  scope_key TEXT NOT NULL,
  board_external_id INTEGER,
  board_name TEXT,
  sync_mode TEXT NOT NULL DEFAULT 'full' CHECK (sync_mode IN ('full', 'since_last')),
  requested_since TEXT,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  status TEXT NOT NULL CHECK (status IN ('running', 'completed', 'failed')),
  boards_synced INTEGER NOT NULL DEFAULT 0,
  sprints_synced INTEGER NOT NULL DEFAULT 0,
  issues_synced INTEGER NOT NULL DEFAULT 0,
  total_issues INTEGER,
  error_message TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS team_members (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  alias_code TEXT NOT NULL UNIQUE,
  role_title TEXT,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS initiative_configs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  description TEXT,
  epic_jql TEXT NOT NULL,
  epic_keys_json TEXT NOT NULL DEFAULT '[]',
  success_rules_json TEXT NOT NULL DEFAULT '{}',
  is_enabled INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS boards (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  external_board_id INTEGER NOT NULL UNIQUE,
  name TEXT NOT NULL,
  project_key TEXT,
  board_type TEXT,
  raw_json TEXT NOT NULL DEFAULT '{}',
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS sprints (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  external_sprint_id INTEGER NOT NULL UNIQUE,
  board_external_id INTEGER,
  name TEXT NOT NULL,
  state TEXT NOT NULL,
  start_date TEXT,
  end_date TEXT,
  complete_date TEXT,
  goal TEXT,
  raw_json TEXT NOT NULL DEFAULT '{}',
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (board_external_id) REFERENCES boards(external_board_id)
);

CREATE TABLE IF NOT EXISTS jira_project_versions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_key TEXT,
  version_id TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  archived INTEGER NOT NULL DEFAULT 0,
  released INTEGER NOT NULL DEFAULT 0,
  start_date TEXT,
  release_date TEXT,
  raw_json TEXT NOT NULL DEFAULT '{}',
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(project_key, version_id)
);

CREATE TABLE IF NOT EXISTS issues (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  issue_key TEXT NOT NULL UNIQUE,
  issue_id TEXT NOT NULL,
  project_key TEXT,
  issue_type TEXT,
  summary TEXT NOT NULL,
  status_name TEXT NOT NULL,
  status_category TEXT,
  priority TEXT,
  assignee_account_id TEXT,
  reporter_account_id TEXT,
  story_points REAL,
  sprint_external_id INTEGER,
  epic_key TEXT,
  parent_issue_key TEXT,
  labels_json TEXT NOT NULL DEFAULT '[]',
  components_json TEXT NOT NULL DEFAULT '[]',
  created_at_source TEXT,
  updated_at_source TEXT,
  resolved_at_source TEXT,
  raw_json TEXT NOT NULL DEFAULT '{}',
  synced_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS issue_release_links (
  issue_key TEXT NOT NULL,
  project_key TEXT,
  version_id TEXT NOT NULL,
  version_name TEXT NOT NULL,
  archived INTEGER NOT NULL DEFAULT 0,
  released INTEGER NOT NULL DEFAULT 0,
  release_date TEXT,
  raw_json TEXT NOT NULL DEFAULT '{}',
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY(issue_key, version_id),
  FOREIGN KEY (issue_key) REFERENCES issues(issue_key)
);

CREATE TABLE IF NOT EXISTS issue_changelog (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  issue_key TEXT NOT NULL,
  history_id TEXT,
  changed_at TEXT NOT NULL,
  author_account_id TEXT,
  field_name TEXT NOT NULL,
  from_value TEXT,
  to_value TEXT,
  raw_json TEXT NOT NULL DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS metric_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  snapshot_type TEXT NOT NULL,
  scope_key TEXT NOT NULL,
  window_start TEXT NOT NULL,
  window_end TEXT NOT NULL,
  metric_key TEXT NOT NULL,
  metric_value_num REAL,
  metric_value_text TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  generated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS report_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  report_type TEXT NOT NULL DEFAULT 'executive',
  period_start TEXT NOT NULL,
  period_end TEXT NOT NULL,
  baseline_report_id INTEGER,
  status TEXT NOT NULL DEFAULT 'generated',
  summary_markdown TEXT NOT NULL,
  payload_json TEXT NOT NULL DEFAULT '{}',
  generated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (baseline_report_id) REFERENCES report_runs(id)
);

CREATE TABLE IF NOT EXISTS epic_groups (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE COLLATE NOCASE,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS work_types (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE COLLATE NOCASE,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS epic_metadata (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  epic_key TEXT NOT NULL UNIQUE,
  epic_name TEXT,
  success_criteria_json TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS epic_metadata_groups (
  epic_metadata_id INTEGER NOT NULL,
  group_id INTEGER NOT NULL,
  PRIMARY KEY(epic_metadata_id, group_id),
  FOREIGN KEY (epic_metadata_id) REFERENCES epic_metadata(id),
  FOREIGN KEY (group_id) REFERENCES epic_groups(id)
);

CREATE TABLE IF NOT EXISTS epic_metadata_work_types (
  epic_metadata_id INTEGER NOT NULL,
  work_type_id INTEGER NOT NULL,
  PRIMARY KEY(epic_metadata_id, work_type_id),
  FOREIGN KEY (epic_metadata_id) REFERENCES epic_metadata(id),
  FOREIGN KEY (work_type_id) REFERENCES work_types(id)
);

CREATE INDEX IF NOT EXISTS idx_issues_updated_at_source ON issues(updated_at_source);
CREATE INDEX IF NOT EXISTS idx_issues_assignee ON issues(assignee_account_id);
CREATE INDEX IF NOT EXISTS idx_issues_sprint ON issues(sprint_external_id);
CREATE INDEX IF NOT EXISTS idx_jira_project_versions_project ON jira_project_versions(project_key, released, archived);
CREATE INDEX IF NOT EXISTS idx_issue_release_links_version ON issue_release_links(version_id, project_key);
CREATE INDEX IF NOT EXISTS idx_issue_release_links_issue ON issue_release_links(issue_key);
CREATE INDEX IF NOT EXISTS idx_issue_changelog_issue_changed ON issue_changelog(issue_key, changed_at);
CREATE INDEX IF NOT EXISTS idx_metric_snapshots_lookup ON metric_snapshots(snapshot_type, scope_key, window_start, window_end);
CREATE INDEX IF NOT EXISTS idx_report_runs_period ON report_runs(period_start, period_end);
CREATE INDEX IF NOT EXISTS idx_sync_checkpoints_lookup ON sync_checkpoints(source_type, scope_key);
CREATE INDEX IF NOT EXISTS idx_sync_run_history_lookup ON sync_run_history(source_type, started_at);
CREATE INDEX IF NOT EXISTS idx_epic_metadata_updated ON epic_metadata(updated_at);

INSERT OR IGNORE INTO schema_migrations(version) VALUES ('0001_initial');
