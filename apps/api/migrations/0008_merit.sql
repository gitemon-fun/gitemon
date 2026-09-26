-- v7 Merit. merit = a player's own work, consistency over volume (V7-D2); recomputed on every ingest.
ALTER TABLE gitemon ADD COLUMN merit REAL NOT NULL DEFAULT 0;
-- signs on houses (V7-D5): a template + an optional filtered project name; the only link is the
-- website on the player's own GitHub profile (read from their snapshot, never typed)
CREATE TABLE sign (
  player_id INTEGER PRIMARY KEY,
  template TEXT NOT NULL,
  project TEXT,
  hidden INTEGER NOT NULL DEFAULT 0,
  reports INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL
);
