-- Population per biome, kept by ingest. Avoids full-table COUNT(*) scans (D1 bills rows read).
CREATE TABLE biome_pop (t1 TEXT PRIMARY KEY, n INTEGER NOT NULL DEFAULT 0);
INSERT INTO biome_pop (t1, n) SELECT t1, COUNT(*) FROM gitemon GROUP BY t1;
