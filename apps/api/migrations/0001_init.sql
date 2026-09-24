-- Gitemon v1 schema. D1 is the source of truth; KV and R2 are rebuildable caches.

CREATE TABLE gitemon (
  id INTEGER PRIMARY KEY,               -- GitHub user id (stable across renames)
  login TEXT NOT NULL,
  name TEXT,
  status TEXT NOT NULL DEFAULT 'wild',  -- wild | claimed
  hidden INTEGER NOT NULL DEFAULT 0,    -- released by its owner, or hidden by an admin
  x INTEGER NOT NULL,
  y INTEGER NOT NULL,
  t1 TEXT NOT NULL,
  t2 TEXT,
  shape TEXT NOT NULL,
  form INTEGER NOT NULL,
  shiny INTEGER NOT NULL,
  machine INTEGER NOT NULL,
  level INTEGER NOT NULL,
  notable INTEGER NOT NULL,
  stats TEXT NOT NULL,                  -- JSON Stats
  scorer_version INTEGER NOT NULL,
  snapshot TEXT NOT NULL,               -- JSON Snapshot (public data only)
  fetched_at TEXT NOT NULL,
  chunk INTEGER NOT NULL,               -- (y / CHUNK) * (WORLD_W / CHUNK) + x / CHUNK
  aura_until TEXT,                      -- friendship aura visible on the map until this time
  created_at TEXT NOT NULL,
  claimed_at TEXT,
  town_id INTEGER,
  caught_count INTEGER NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX gitemon_login ON gitemon (login COLLATE NOCASE);
CREATE UNIQUE INDEX gitemon_slot ON gitemon (x, y);
CREATE INDEX gitemon_notable ON gitemon (t1, notable DESC) WHERE hidden = 0;
CREATE INDEX gitemon_stale ON gitemon (fetched_at);
CREATE INDEX gitemon_chunk ON gitemon (chunk);
CREATE INDEX gitemon_town ON gitemon (town_id) WHERE town_id IS NOT NULL;

CREATE TABLE players (
  id INTEGER PRIMARY KEY,               -- GitHub user id
  workos_id TEXT NOT NULL UNIQUE,
  email TEXT,
  token_enc TEXT,                       -- AES-GCM, key in a Worker secret; read:user only
  is_admin INTEGER NOT NULL DEFAULT 0,
  real INTEGER NOT NULL DEFAULT 0,      -- passed the realness gate at claim time
  created_at TEXT NOT NULL,
  last_seen TEXT NOT NULL
);

CREATE TABLE catches (
  catcher_id INTEGER NOT NULL,
  target_id INTEGER NOT NULL,
  n INTEGER NOT NULL,                   -- this was the n-th catch of the target (scout order)
  bonded INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  PRIMARY KEY (catcher_id, target_id)
);
CREATE INDEX catches_target ON catches (target_id);
CREATE INDEX catches_day ON catches (catcher_id, created_at);

CREATE TABLE buffs (
  user_id INTEGER NOT NULL,
  source_id INTEGER NOT NULL,           -- the other side of the pair
  kind TEXT NOT NULL,                   -- claimed | scout | claimer
  xp INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (user_id, source_id)
);

CREATE TABLE towns (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  biome TEXT NOT NULL,
  plot INTEGER NOT NULL,
  kind TEXT NOT NULL DEFAULT 'clan',    -- clan | official
  owner_login TEXT,                     -- official towns: the GitHub owner they stand for
  founder_id INTEGER,
  members INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE UNIQUE INDEX towns_name ON towns (name COLLATE NOCASE);
CREATE UNIQUE INDEX towns_plot ON towns (biome, plot);

CREATE TABLE admin_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  admin_id INTEGER NOT NULL,
  action TEXT NOT NULL,
  target_id INTEGER,
  note TEXT,
  created_at TEXT NOT NULL
);

-- logins someone asked for while no server token was available; drained by a trusted fetcher
CREATE TABLE pending (
  login TEXT PRIMARY KEY COLLATE NOCASE,
  requested_at TEXT NOT NULL
);
