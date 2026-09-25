-- Gitemon City (v2): hometown (V2-D6) and the owner's opt-out. Identity only, never placement.
ALTER TABLE gitemon ADD COLUMN country TEXT;   -- ISO 3166-1 alpha-2, parsed from the public GitHub location
ALTER TABLE gitemon ADD COLUMN city TEXT;
ALTER TABLE gitemon ADD COLUMN hide_home INTEGER NOT NULL DEFAULT 0;
CREATE INDEX gitemon_country ON gitemon (country, notable DESC) WHERE country IS NOT NULL AND hidden = 0;
