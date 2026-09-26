-- v5 (V5-D3, V5-D4): the specials. Sealed until their developer signs in: nothing here is ever
-- served with a name or a GitHub id while `woken_at` is null. Only derived creature fields are kept —
-- no profile snapshot.
CREATE TABLE legend (
  id INTEGER PRIMARY KEY,            -- GitHub user id (recognises the developer at sign-in)
  key TEXT NOT NULL UNIQUE,          -- opaque public key, random, never derived from the id
  login TEXT NOT NULL,               -- private: used only to recognise a rename at import
  rank INTEGER NOT NULL,
  tier TEXT NOT NULL,                -- legendary | mythic | epic | rare
  title TEXT,                        -- 'The Origin' | 'The Guardians'
  species TEXT,                      -- a one-of-one species (the top three), else null
  t1 TEXT NOT NULL,
  t2 TEXT,
  shape TEXT NOT NULL,
  form INTEGER NOT NULL,
  shiny INTEGER NOT NULL,
  woken_at TEXT,                     -- set when the developer signs in and wakes it
  imported_at TEXT NOT NULL
);
CREATE INDEX legend_rank ON legend (rank);
-- a developer who removed their legend is never imported again
CREATE TABLE legend_removed (
  id INTEGER PRIMARY KEY,
  removed_at TEXT NOT NULL
);
