-- v5 (V5-D1): location is dropped entirely. The map is fictional; a developer's location was the most
-- personal data held. Backup taken first (2026-09-26, outside the repo).
DROP INDEX IF EXISTS gitemon_country;
ALTER TABLE gitemon DROP COLUMN country;
ALTER TABLE gitemon DROP COLUMN city;
ALTER TABLE gitemon DROP COLUMN hide_home;
-- the stored public snapshots carried the free-text location and the parsed hometown too
UPDATE gitemon SET snapshot = json_remove(snapshot, '$.location', '$.home')
  WHERE json_extract(snapshot, '$.location') IS NOT NULL OR json_extract(snapshot, '$.home') IS NOT NULL;
