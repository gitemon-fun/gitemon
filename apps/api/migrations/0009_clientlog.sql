-- client reports (debugging a blank map on some GPUs): errors, the GPU name and one frame check per
-- visit, kept so they can be read later without a live log tail. Only the newest 500 rows are kept.
CREATE TABLE clientlog (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at TEXT NOT NULL,
  ua TEXT,
  body TEXT NOT NULL
);
