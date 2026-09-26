-- v6 Walk the Island. The daily job freezes the day's layout and each legend's spot, so the Worker
-- can check "within 10 m" without recomputing the island (its CPU budget is 10 ms).
CREATE TABLE meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
CREATE TABLE legend_spot (
  day TEXT NOT NULL,
  key TEXT NOT NULL,
  x REAL NOT NULL,
  z REAL NOT NULL,
  PRIMARY KEY (day, key)
);
-- the Legend Log (V6-D3): first sighting per player per legend
CREATE TABLE legend_seen (
  player_id INTEGER NOT NULL,
  key TEXT NOT NULL,
  day TEXT NOT NULL,
  PRIMARY KEY (player_id, key)
);
ALTER TABLE players ADD COLUMN streak INTEGER NOT NULL DEFAULT 0;
ALTER TABLE players ADD COLUMN streak_day TEXT;
ALTER TABLE players ADD COLUMN walked_m REAL NOT NULL DEFAULT 0;
ALTER TABLE players ADD COLUMN walk_day TEXT;
-- the blessing (V6-D4): '<tier>:<level>' while aura_until is in the future; the friendship aura has none
ALTER TABLE gitemon ADD COLUMN aura_tier TEXT;
