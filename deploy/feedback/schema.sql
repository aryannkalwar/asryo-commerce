CREATE TABLE IF NOT EXISTS design_preferences (
  visitor_id TEXT PRIMARY KEY,
  design TEXT NOT NULL CHECK(design IN ('speed-division','dream-future','shadowbound')),
  source TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS design_preferences_expiry ON design_preferences(updated_at);
