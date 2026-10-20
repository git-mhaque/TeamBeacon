-- Plan-owned schedules are versioned documents. Baselines are immutable snapshots.
CREATE TABLE IF NOT EXISTS delivery_plans (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  version INTEGER NOT NULL DEFAULT 1,
  document_json TEXT NOT NULL,
  baseline_json TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
